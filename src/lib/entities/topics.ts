import { and, count, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { config, messages, topics, nowUtc, type Topic } from "@/db/schema";
import { evaluatePattern } from "@/lib/patterns";
import { blockingMcs, type BlockingMc } from "@/lib/entities/mc-refs";

const WRITABLE_FIELDS = [
  "key",
  "name",
  "orderIndex",
  "status",
  "product",
  "tag",
  "tag1",
  "tag2",
  "tag3",
  "tag4",
  "comment",
  "created",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type TopicInput = Partial<Pick<Topic, WritableField>>;

export function pickWritable(input: unknown): TopicInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as TopicInput;
}

// `generatedKey`/`keyStale` expose the drift the MC-guard in updateTopic leaves
// behind: once a topic has MCs, a tag edit no longer moves the key, and without
// this the stale key is invisible in the UI. See entities/rekey.ts.
export type TopicListRow = Topic & {
  mcCount: number;
  generatedKey: string;
  keyStale: boolean;
};

export async function listTopics(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<TopicListRow[]> {
  const where = opts.includeArchived
    ? eq(topics.clientId, clientId)
    : and(eq(topics.clientId, clientId), isNull(topics.archivedAt));
  const rows = await db
    .select()
    .from(topics)
    .where(where)
    .orderBy(topics.orderIndex);
  const counts = await mcCountsByTopic(clientId);
  const pattern = await readTopicKeyPattern(clientId);
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

async function mcCountsByTopic(
  clientId: number,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ key: messages.topic, n: count() })
    .from(messages)
    // Scoped by AUDIENCE, not by topic: a draft's topic is a suggested name and
    // may happen to spell a real topic key, which would inflate that topic's MC
    // count with work that is not in the matrix yet.
    .where(and(eq(messages.clientId, clientId), isNotNull(messages.audience)))
    .groupBy(messages.topic);
  const m = new Map<string, number>();
  // Placed rows always carry a topic (check `messages_placed_has_topic`); the
  // guard restates that for the type system.
  for (const r of rows) if (r.key !== null) m.set(r.key, r.n);
  return m;
}

export async function countMessagesByTopic(
  clientId: number,
  topicKey: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.topic, topicKey)));
  return row?.n ?? 0;
}

export async function getTopic(
  clientId: number,
  id: number,
): Promise<Topic | null> {
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function nextOrderIndex(clientId: number): Promise<number> {
  const [row] = await db
    .select({ m: max(topics.orderIndex) })
    .from(topics)
    .where(eq(topics.clientId, clientId));
  return (row?.m ?? -1) + 1;
}

async function readTopicKeyPattern(clientId: number): Promise<string | null> {
  const [row] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .limit(1);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { topicKey?: string };
    return parsed.topicKey ?? null;
  } catch {
    return null;
  }
}

// A key pattern such as "{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}"
// collapses to bare separators ("____") while every field is still empty — the
// normal state of a freshly added row. That is not a usable key, so treat a
// separator-only result the same as an empty one and fall back.
function hasKeyContent(s: string): boolean {
  return /[a-z0-9]/i.test(s);
}

export type TopicKeyContext = Pick<
  Topic,
  "product" | "tag1" | "tag2" | "tag3" | "tag4"
>;

// Pattern already in hand — the list path evaluates it for every row and must
// not re-read config once per topic.
function keyFromPattern(
  pattern: string | null,
  context: TopicKeyContext,
  orderIndex: number,
): string {
  if (pattern) {
    const out = evaluatePattern(pattern, context as Record<string, unknown>);
    if (hasKeyContent(out)) return out;
  }
  return `top${orderIndex + 1}`;
}

// Spec §3.2:
//   If config.patterns.topicKey is set, evaluate it.
//   Otherwise: top{order_index+1}.
export async function generateTopicKey(
  clientId: number,
  context: TopicKeyContext,
  orderIndex: number,
): Promise<string> {
  return keyFromPattern(await readTopicKeyPattern(clientId), context, orderIndex);
}

// (client_id, key) is unique, so a generated key that is already taken — two
// topics with the same product/tags, or a reused order_index after the last row
// was deleted — must be suffixed instead of blowing up the insert.
async function ensureUniqueKey(
  clientId: number,
  candidate: string,
  excludeId?: number,
): Promise<string> {
  const clash = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, candidate)))
    .limit(1);
  if (clash.length === 0 || clash[0].id === excludeId) return candidate;
  return nextKeyForDuplicate(clientId, candidate);
}

const KEY_REGEN_FIELDS: ReadonlyArray<keyof Topic> = [
  "product",
  "tag1",
  "tag2",
  "tag3",
  "tag4",
];

function shouldRegenerateKey(before: Topic, input: TopicInput): boolean {
  for (const f of KEY_REGEN_FIELDS) {
    if (f in input && input[f as keyof TopicInput] !== before[f]) {
      return true;
    }
  }
  return false;
}

export class TopicError extends Error {}

export async function createTopic(
  clientId: number,
  input: TopicInput,
): Promise<Topic> {
  if (!input.name) throw new TopicError("name is required");
  const orderIndex = input.orderIndex ?? (await nextOrderIndex(clientId));

  const key = await ensureUniqueKey(
    clientId,
    input.key ??
      (await generateTopicKey(
        clientId,
        {
          product: input.product ?? null,
          tag1: input.tag1 ?? null,
          tag2: input.tag2 ?? null,
          tag3: input.tag3 ?? null,
          tag4: input.tag4 ?? null,
        },
        orderIndex,
      )),
  );

  const [row] = await db
    .insert(topics)
    .values({
      clientId,
      key,
      name: input.name,
      orderIndex,
      status: input.status,
      product: input.product,
      tag: input.tag,
      tag1: input.tag1,
      tag2: input.tag2,
      tag3: input.tag3,
      tag4: input.tag4,
      comment: input.comment,
      created: input.created,
    })
    .returning();
  return row;
}

export async function updateTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: TopicInput,
): Promise<{ ok: true; row: Topic } | { ok: false; current: Topic | null }> {
  const current = await getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }

  const merged = { ...current, ...input } as Topic;
  let key = input.key ?? current.key;
  // MC-guard: regen only when no message references the current key.
  // Renaming a topic that has live (or archived) MCs would orphan them.
  if (
    input.key === undefined &&
    shouldRegenerateKey(current, input) &&
    (await countMessagesByTopic(clientId, current.key)) === 0
  ) {
    key = await ensureUniqueKey(
      clientId,
      await generateTopicKey(
        clientId,
        {
          product: merged.product,
          tag1: merged.tag1,
          tag2: merged.tag2,
          tag3: merged.tag3,
          tag4: merged.tag4,
        },
        merged.orderIndex,
      ),
      id,
    );
  }

  const [updated] = await db
    .update(topics)
    .set({
      ...input,
      key,
      version: sql`${topics.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Cascade archive: topic archive → also archives every message attached to
// this topic by key. Reporting NOT cascaded (history). Atomic via transaction.
export async function archiveTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  | { ok: true; row: Topic; cascadedMessageIds: number[] }
  | { ok: false; current: Topic | null }
> {
  const current = await getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(topics)
      .set({
        archivedAt: nowUtc,
        version: sql`${topics.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
      .returning();

    const cascadedMessages = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.topic, current.key),
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
            eq(messages.topic, current.key),
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

// Suffix-aware name/key bump for duplicate (same rules as audiences).
const NAME_SUFFIX_RE = /^(.+) \((\d+)\)$/;
const KEY_SUFFIX_RE = /^(.+)_(\d+)$/;

function nextNameSuffix(name: string): string {
  const m = NAME_SUFFIX_RE.exec(name);
  if (m) return `${m[1]} (${Number(m[2]) + 1})`;
  return `${name} (1)`;
}

async function nextKeyForDuplicate(
  clientId: number,
  sourceKey: string,
): Promise<string> {
  const m = KEY_SUFFIX_RE.exec(sourceKey);
  const base = m ? m[1] : sourceKey;
  const existing = await db
    .select({ key: topics.key })
    .from(topics)
    .where(eq(topics.clientId, clientId));
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

export async function duplicateTopic(
  clientId: number,
  id: number,
): Promise<Topic | null> {
  const src = await getTopic(clientId, id);
  if (!src) return null;
  const orderIndex = await nextOrderIndex(clientId);
  const [row] = await db
    .insert(topics)
    .values({
      clientId,
      key: await nextKeyForDuplicate(clientId, src.key),
      name: nextNameSuffix(src.name),
      orderIndex,
      status: src.status,
      product: src.product,
      tag: src.tag,
      tag1: src.tag1,
      tag2: src.tag2,
      tag3: src.tag3,
      tag4: src.tag4,
      comment: src.comment,
      created: src.created,
    })
    .returning();
  return row;
}

export type DeleteTopicResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_mismatch"; current: Topic }
  | { ok: false; reason: "in_use"; referencedBy: BlockingMc[] };

export async function deleteTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<DeleteTopicResult> {
  const current = await getTopic(clientId, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch", current };
  }
  const refs = await blockingMcs(clientId, "topic", current.key);
  if (refs.length > 0) {
    return { ok: false, reason: "in_use", referencedBy: refs };
  }
  await db
    .delete(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)));
  return { ok: true };
}

export async function restoreTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<{ ok: true; row: Topic } | { ok: false; current: Topic | null }> {
  const current = await getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(topics)
    .set({
      archivedAt: null,
      version: sql`${topics.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Drag-drop reorder of topic rows/columns in the matrix (edit mode). Unlike
// keywords-reorder (which reindexes 0..N over the whole field), the matrix only
// ever sends the ids of the *currently visible axis subset*, so we must NOT
// touch the positions of the rows the client did not send. We permute the
// group *within the orderIndex slots it already occupies*: collect the group's
// current slots, sort them, and reassign in the new order. Rows outside the
// group keep their orderIndex untouched, so DCO and Agentic sets never interleave.
export async function reorderTopics(
  clientId: number,
  ids: number[],
): Promise<void> {
  if (ids.length < 2) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: topics.id, orderIndex: topics.orderIndex })
      .from(topics)
      .where(and(eq(topics.clientId, clientId), inArray(topics.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r.orderIndex]));
    const present = ids.filter((id) => byId.has(id));
    if (present.length < 2) return;
    const slots = present.map((id) => byId.get(id)!).sort((a, b) => a - b);
    for (let i = 0; i < present.length; i++) {
      await tx
        .update(topics)
        .set({ orderIndex: slots[i], updatedAt: nowUtc })
        .where(and(eq(topics.clientId, clientId), eq(topics.id, present[i])));
    }
  });
}
