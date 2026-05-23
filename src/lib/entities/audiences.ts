import { and, count, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { audiences, config, messages, type Audience } from "@/db/schema";
import { evaluatePattern } from "@/lib/patterns";

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

export function listAudiences(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Audience[] {
  const where = opts.includeArchived
    ? eq(audiences.clientId, clientId)
    : and(eq(audiences.clientId, clientId), isNull(audiences.archivedAt));
  const rows = db
    .select()
    .from(audiences)
    .where(where)
    .orderBy(audiences.orderIndex)
    .all();
  const counts = mcCountsByAudience(clientId);
  return rows.map((r) => ({ ...r, mcCount: counts.get(r.key) ?? 0 }));
}

// Map<audience.key, count of messages referencing it (archived OR live)>.
// One query for the whole client, used by listAudiences and the update-regen
// guard.
function mcCountsByAudience(clientId: number): Map<string, number> {
  const rows = db
    .select({ key: messages.audience, n: count() })
    .from(messages)
    .where(eq(messages.clientId, clientId))
    .groupBy(messages.audience)
    .all();
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.key, r.n);
  return m;
}

export function countMessagesByAudience(
  clientId: number,
  audienceKey: string,
): number {
  const row = db
    .select({ n: count() })
    .from(messages)
    .where(
      and(eq(messages.clientId, clientId), eq(messages.audience, audienceKey)),
    )
    .get();
  return row?.n ?? 0;
}

export function getAudience(clientId: number, id: number): Audience | null {
  return (
    db
      .select()
      .from(audiences)
      .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
      .get() ?? null
  );
}

function nextOrderIndex(clientId: number): number {
  const row = db
    .select({ m: max(audiences.orderIndex) })
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .get();
  return (row?.m ?? -1) + 1;
}

function readAudienceKeyPattern(clientId: number): string | null {
  const row = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { audienceKey?: string };
    return parsed.audienceKey ?? null;
  } catch {
    return null;
  }
}

// If config.patterns.audienceKey is set, evaluate it. Otherwise: aud{N+1}.
// Pattern context includes product + strategy + buyingPlatform + device + tag.
export function generateAudienceKey(
  clientId: number,
  context: Pick<
    Audience,
    "product" | "strategy" | "buyingPlatform" | "device" | "tag"
  >,
  orderIndex: number,
): string {
  const pattern = readAudienceKeyPattern(clientId);
  if (pattern) {
    const out = evaluatePattern(pattern, context as Record<string, unknown>);
    if (out.trim() !== "") return out;
  }
  return `aud${orderIndex + 1}`;
}

export function createAudience(
  clientId: number,
  input: AudienceInput,
): Audience {
  const orderIndex = input.orderIndex ?? nextOrderIndex(clientId);
  const key =
    input.key ??
    generateAudienceKey(
      clientId,
      {
        product: input.product ?? null,
        strategy: input.strategy ?? null,
        buyingPlatform: input.buyingPlatform ?? null,
        device: input.device ?? null,
        tag: input.tag ?? null,
      },
      orderIndex,
    );
  if (!input.name) {
    throw new BadRequest("name is required");
  }
  return db
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
    })
    .returning()
    .get();
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

export function updateAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: AudienceInput,
): { ok: true; row: Audience } | { ok: false; current: Audience | null } {
  const current = getAudience(clientId, id);
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
    countMessagesByAudience(clientId, current.key) === 0
  ) {
    const merged = { ...current, ...input } as Audience;
    key = generateAudienceKey(
      clientId,
      {
        product: merged.product,
        strategy: merged.strategy,
        buyingPlatform: merged.buyingPlatform,
        device: merged.device,
        tag: merged.tag,
      },
      merged.orderIndex,
    );
  }

  const updated = db
    .update(audiences)
    .set({
      ...input,
      key,
      version: sql`${audiences.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

// Cascade archive: audience archive → also archives every message attached to
// this audience by key. Reporting rows are NOT cascaded (history preserved).
// Atomic via transaction.
export type ArchiveResult<T> =
  | { ok: true; row: T; cascadedMessageIds: number[] }
  | { ok: false; current: T | null };

export function archiveAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): ArchiveResult<Audience> {
  const current = getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };

  return db.transaction((tx) => {
    const updated = tx
      .update(audiences)
      .set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
        version: sql`${audiences.version} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
      .returning()
      .get();

    const cascadedMessages = tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.audience, current.key),
          isNull(messages.archivedAt),
        ),
      )
      .all();

    if (cascadedMessages.length > 0) {
      tx.update(messages)
        .set({
          archivedAt: sql`CURRENT_TIMESTAMP`,
          version: sql`${messages.version} + 1`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            eq(messages.clientId, clientId),
            eq(messages.audience, current.key),
            isNull(messages.archivedAt),
          ),
        )
        .run();
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
function nextKeyForDuplicate(clientId: number, sourceKey: string): string {
  const m = KEY_SUFFIX_RE.exec(sourceKey);
  const base = m ? m[1] : sourceKey;
  const existing = db
    .select({ key: audiences.key })
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .all();
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

export function duplicateAudience(clientId: number, id: number): Audience | null {
  const src = getAudience(clientId, id);
  if (!src) return null;
  const orderIndex = nextOrderIndex(clientId);
  return db
    .insert(audiences)
    .values({
      clientId,
      key: nextKeyForDuplicate(clientId, src.key),
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
    })
    .returning()
    .get();
}

// Hard delete. Refuses if any message row references the audience by key
// (archived OR live — hard-deleting would orphan an archived MC if later
// restored).
export type DeleteResult<T> =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_mismatch"; current: T }
  | { ok: false; reason: "in_use"; referencedBy: number[] };

export function deleteAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): DeleteResult<Audience> {
  const current = getAudience(clientId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch", current };
  }
  const refs = db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.audience, current.key),
      ),
    )
    .limit(50)
    .all();
  if (refs.length > 0) {
    return { ok: false, reason: "in_use", referencedBy: refs.map((r) => r.id) };
  }
  db.delete(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .run();
  return { ok: true };
}

// Restore an audience. No parent-first guard (audiences are top-level).
// Does NOT cascade-restore the messages — user must restore those individually
// if they want them back.
export function restoreAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Audience } | { ok: false; current: Audience | null } {
  const current = getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(audiences)
    .set({
      archivedAt: null,
      version: sql`${audiences.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}
