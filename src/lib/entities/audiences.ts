import { and, count, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { audiences, config, messages, nowUtc, type Audience } from "@/db/schema";
import { evaluatePattern } from "@/lib/patterns";
import { blockingMcs, type BlockingMc } from "@/lib/entities/mc-refs";

const WRITABLE_FIELDS = [
  "key",
  "name",
  "orderIndex",
  "status",
  "product",
  "strategy",
  "buyingPlatform",
  "dataSource",
  "targetingType",
  "device",
  "tag",
  "comment",
  "campaignName",
  "campaignId",
  "lineitemName",
  "lineitemId",
  "channel",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type AudienceInput = Partial<Pick<Audience, WritableField>>;

export function pickWritable(input: unknown): AudienceInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as AudienceInput;
}

// `generatedKey`/`keyStale` expose the drift the MC-guard in updateAudience
// leaves behind: once an audience has MCs, a product/strategy edit no longer
// moves the key, and without this the stale key is invisible. See rekey.ts.
export type AudienceListRow = Audience & {
  mcCount: number;
  generatedKey: string;
  keyStale: boolean;
};

export async function listAudiences(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<AudienceListRow[]> {
  const where = opts.includeArchived
    ? eq(audiences.clientId, clientId)
    : and(eq(audiences.clientId, clientId), isNull(audiences.archivedAt));
  const rows = await db
    .select()
    .from(audiences)
    .where(where)
    .orderBy(audiences.orderIndex);
  const counts = await mcCountsByAudience(clientId);
  const pattern = await readAudienceKeyPattern(clientId);
  return rows.map((r) => {
    const generatedKey = keyFromPattern(pattern, r, r.orderIndex);
    return {
      ...r,
      mcCount: counts.get(r.key) ?? 0,
      generatedKey,
      keyStale: generatedKey !== r.key,
    };
  });
}

// Map<audience.key, count of messages referencing it (archived OR live)>.
// One query for the whole client, used by listAudiences and the update-regen
// guard.
async function mcCountsByAudience(
  clientId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ key: messages.audience, n: count() })
    .from(messages)
    // A DRAFT has no audience, so it belongs to no column and must not be
    // counted into one.
    .where(and(eq(messages.clientId, clientId), isNotNull(messages.audience)))
    .groupBy(messages.audience);
  const m = new Map<string, number>();
  // The WHERE above already excludes the null key; the guard is how that fact
  // reaches the type system, which types the column from the schema.
  for (const r of rows) if (r.key !== null) m.set(r.key, r.n);
  return m;
}

export async function countMessagesByAudience(
  clientId: number,
  audienceKey: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(
      and(eq(messages.clientId, clientId), eq(messages.audience, audienceKey)),
    );
  return row?.n ?? 0;
}

export async function getAudience(
  clientId: number,
  id: number,
): Promise<Audience | null> {
  const rows = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function nextOrderIndex(clientId: number): Promise<number> {
  const [row] = await db
    .select({ m: max(audiences.orderIndex) })
    .from(audiences)
    .where(eq(audiences.clientId, clientId));
  return (row?.m ?? -1) + 1;
}

async function readAudienceKeyPattern(
  clientId: number,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { audienceKey?: string };
    return parsed.audienceKey ?? null;
  } catch {
    return null;
  }
}

// A key pattern such as "{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}"
// collapses to bare separators ("____") while every field it reads is still
// empty — the normal state of a freshly added row. That is not a usable key,
// so treat a separator-only result the same as an empty one and fall back.
function hasKeyContent(s: string): boolean {
  return /[a-z0-9]/i.test(s);
}

export type AudienceKeyContext = Pick<
  Audience,
  "product" | "strategy" | "buyingPlatform" | "device" | "tag"
>;

// Pattern already in hand — the list path evaluates it for every row and must
// not re-read config once per audience.
function keyFromPattern(
  pattern: string | null,
  context: AudienceKeyContext,
  orderIndex: number,
): string {
  if (pattern) {
    const out = evaluatePattern(pattern, context as Record<string, unknown>);
    if (hasKeyContent(out)) return out;
  }
  return `aud${orderIndex + 1}`;
}

// If config.patterns.audienceKey is set, evaluate it. Otherwise: aud{N+1}.
// Pattern context includes product + strategy + buyingPlatform + device + tag.
export async function generateAudienceKey(
  clientId: number,
  context: AudienceKeyContext,
  orderIndex: number,
): Promise<string> {
  return keyFromPattern(
    await readAudienceKeyPattern(clientId),
    context,
    orderIndex,
  );
}

// (client_id, key) is unique, so a generated key that is already taken — two
// audiences with the same product/strategy/…, or a reused order_index after
// the last row was deleted — must be suffixed instead of blowing up the insert.
async function ensureUniqueKey(
  clientId: number,
  candidate: string,
  excludeId?: number,
): Promise<string> {
  const clash = await db
    .select({ id: audiences.id })
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.key, candidate)))
    .limit(1);
  if (clash.length === 0 || clash[0].id === excludeId) return candidate;
  return nextKeyForDuplicate(clientId, candidate);
}

export async function createAudience(
  clientId: number,
  input: AudienceInput,
): Promise<Audience> {
  const orderIndex = input.orderIndex ?? (await nextOrderIndex(clientId));
  const key = await ensureUniqueKey(
    clientId,
    input.key ??
      (await generateAudienceKey(
        clientId,
        {
          product: input.product ?? null,
          strategy: input.strategy ?? null,
          buyingPlatform: input.buyingPlatform ?? null,
          device: input.device ?? null,
          tag: input.tag ?? null,
        },
        orderIndex,
      )),
  );
  if (!input.name) {
    throw new BadRequest("name is required");
  }
  const [row] = await db
    .insert(audiences)
    .values({
      clientId,
      key,
      name: input.name,
      orderIndex,
      status: input.status,
      product: input.product,
      strategy: input.strategy,
      buyingPlatform: input.buyingPlatform,
      dataSource: input.dataSource,
      targetingType: input.targetingType,
      device: input.device,
      tag: input.tag,
      comment: input.comment,
      campaignName: input.campaignName,
      campaignId: input.campaignId,
      lineitemName: input.lineitemName,
      lineitemId: input.lineitemId,
      channel: input.channel,
    })
    .returning();
  return row;
}

// Fields that, when changed, may trigger an auto-key regeneration (matches
// the default audienceKey pattern context).
const KEY_REGEN_FIELDS: ReadonlyArray<keyof Audience> = [
  "product",
  "strategy",
  "buyingPlatform",
  "device",
  "tag",
];

function shouldRegenerateAudienceKey(
  before: Audience,
  input: AudienceInput,
): boolean {
  for (const f of KEY_REGEN_FIELDS) {
    if (f in input && input[f as keyof AudienceInput] !== before[f]) {
      return true;
    }
  }
  return false;
}

export async function updateAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: AudienceInput,
): Promise<
  { ok: true; row: Audience } | { ok: false; current: Audience | null }
> {
  const current = await getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }

  // Auto-key regen: only if no explicit key in the patch, the key-relevant
  // fields actually changed, AND no MC references the current key. The MC
  // guard prevents orphaning live messages by silently renaming their
  // referenced audience.
  let key = input.key ?? current.key;
  if (
    input.key === undefined &&
    shouldRegenerateAudienceKey(current, input) &&
    (await countMessagesByAudience(clientId, current.key)) === 0
  ) {
    const merged = { ...current, ...input } as Audience;
    key = await ensureUniqueKey(
      clientId,
      await generateAudienceKey(
        clientId,
        {
          product: merged.product,
          strategy: merged.strategy,
          buyingPlatform: merged.buyingPlatform,
          device: merged.device,
          tag: merged.tag,
        },
        merged.orderIndex,
      ),
      id,
    );
  }

  const [updated] = await db
    .update(audiences)
    .set({
      ...input,
      key,
      version: sql`${audiences.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Cascade archive: audience archive → also archives every message attached to
// this audience by key. Reporting rows are NOT cascaded (history preserved).
// Atomic via transaction.
export type ArchiveResult<T> =
  | { ok: true; row: T; cascadedMessageIds: number[] }
  | { ok: false; current: T | null };

export async function archiveAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<ArchiveResult<Audience>> {
  const current = await getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(audiences)
      .set({
        archivedAt: nowUtc,
        version: sql`${audiences.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
      .returning();

    const cascadedMessages = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.audience, current.key),
          isNull(messages.archivedAt),
        ),
      );

    if (cascadedMessages.length > 0) {
      await tx
        .update(messages)
        .set({
          archivedAt: nowUtc,
          version: sql`${messages.version} + 1`,
          updatedAt: nowUtc,
        })
        .where(
          and(
            eq(messages.clientId, clientId),
            eq(messages.audience, current.key),
            isNull(messages.archivedAt),
          ),
        );
    }

    return {
      ok: true as const,
      row: updated,
      cascadedMessageIds: cascadedMessages.map((m) => m.id),
    };
  });
}

// Suffix-aware name/key bump for duplicate.
// Name: "Foo" → "Foo (1)", "Foo (1)" → "Foo (2)".
// Key:  "aud3" → "aud3_1", "aud3_1" → "aud3_2".
const NAME_SUFFIX_RE = /^(.+) \((\d+)\)$/;
const KEY_SUFFIX_RE = /^(.+)_(\d+)$/;

function nextNameSuffix(name: string): string {
  const m = NAME_SUFFIX_RE.exec(name);
  if (m) return `${m[1]} (${Number(m[2]) + 1})`;
  return `${name} (1)`;
}

// Scan existing audience keys for the same base; pick max(n)+1 to survive
// sparse states like base_1, base_3 → base_4.
async function nextKeyForDuplicate(
  clientId: number,
  sourceKey: string,
): Promise<string> {
  const m = KEY_SUFFIX_RE.exec(sourceKey);
  const base = m ? m[1] : sourceKey;
  const existing = await db
    .select({ key: audiences.key })
    .from(audiences)
    .where(eq(audiences.clientId, clientId));
  const baseEsc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${baseEsc}_(\\d+)$`);
  let max = 0;
  for (const r of existing) {
    const mr = re.exec(r.key);
    if (mr) {
      const n = Number(mr[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `${base}_${max + 1}`;
}

export async function duplicateAudience(
  clientId: number,
  id: number,
): Promise<Audience | null> {
  const src = await getAudience(clientId, id);
  if (!src) return null;
  const orderIndex = await nextOrderIndex(clientId);
  const [row] = await db
    .insert(audiences)
    .values({
      clientId,
      key: await nextKeyForDuplicate(clientId, src.key),
      name: nextNameSuffix(src.name),
      orderIndex,
      status: src.status,
      product: src.product,
      strategy: src.strategy,
      buyingPlatform: src.buyingPlatform,
      dataSource: src.dataSource,
      targetingType: src.targetingType,
      device: src.device,
      tag: src.tag,
      comment: src.comment,
      campaignName: src.campaignName,
      campaignId: src.campaignId,
      lineitemName: src.lineitemName,
      lineitemId: src.lineitemId,
      channel: src.channel,
    })
    .returning();
  return row;
}

// Hard delete. Refuses if any message row references the audience by key
// (archived OR live — hard-deleting would orphan an archived MC if later
// restored).
export type DeleteResult<T> =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_mismatch"; current: T }
  | { ok: false; reason: "in_use"; referencedBy: BlockingMc[] };

export async function deleteAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<DeleteResult<Audience>> {
  const current = await getAudience(clientId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch", current };
  }
  const refs = await blockingMcs(clientId, "audience", current.key);
  if (refs.length > 0) {
    return { ok: false, reason: "in_use", referencedBy: refs };
  }
  await db
    .delete(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)));
  return { ok: true };
}

// Restore an audience. No parent-first guard (audiences are top-level).
// Does NOT cascade-restore the messages — user must restore those individually
// if they want them back.
export async function restoreAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  { ok: true; row: Audience } | { ok: false; current: Audience | null }
> {
  const current = await getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(audiences)
    .set({
      archivedAt: null,
      version: sql`${audiences.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Drag-drop reorder of audience rows/columns in the matrix (edit mode). See
// reorderTopics for the "permute within occupied slots" rationale: the matrix
// only sends the currently visible axis subset, so we permute the group within
// its own orderIndex slots and leave every other audience untouched — this is
// what keeps the DCO (channel==null) and Agentic (channel!=null) sets from
// interleaving when one axis is reordered.
export async function reorderAudiences(
  clientId: number,
  ids: number[],
): Promise<void> {
  if (ids.length < 2) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: audiences.id, orderIndex: audiences.orderIndex })
      .from(audiences)
      .where(and(eq(audiences.clientId, clientId), inArray(audiences.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r.orderIndex]));
    const present = ids.filter((id) => byId.has(id));
    if (present.length < 2) return;
    const slots = present.map((id) => byId.get(id)!).sort((a, b) => a - b);
    for (let i = 0; i < present.length; i++) {
      await tx
        .update(audiences)
        .set({ orderIndex: slots[i], updatedAt: nowUtc })
        .where(and(eq(audiences.clientId, clientId), eq(audiences.id, present[i])));
    }
  });
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}
