import { and, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { config, messages, topics, type Topic } from "@/db/schema";
import { evaluatePattern } from "@/lib/patterns";

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

export function listTopics(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Topic[] {
  const where = opts.includeArchived
    ? eq(topics.clientId, clientId)
    : and(eq(topics.clientId, clientId), isNull(topics.archivedAt));
  return db
    .select()
    .from(topics)
    .where(where)
    .orderBy(topics.orderIndex)
    .all();
}

export function getTopic(clientId: number, id: number): Topic | null {
  return (
    db
      .select()
      .from(topics)
      .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
      .get() ?? null
  );
}

function nextOrderIndex(clientId: number): number {
  const row = db
    .select({ m: max(topics.orderIndex) })
    .from(topics)
    .where(eq(topics.clientId, clientId))
    .get();
  return (row?.m ?? -1) + 1;
}

function readTopicKeyPattern(clientId: number): string | null {
  const row = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { topicKey?: string };
    return parsed.topicKey ?? null;
  } catch {
    return null;
  }
}

// Spec §3.2:
//   If config.patterns.topicKey is set, evaluate it.
//   Otherwise: top{order_index+1}.
export function generateTopicKey(
  clientId: number,
  context: Pick<Topic, "product" | "tag1" | "tag2" | "tag3" | "tag4">,
  orderIndex: number,
): string {
  const pattern = readTopicKeyPattern(clientId);
  if (pattern) {
    const out = evaluatePattern(pattern, context as Record<string, unknown>);
    if (out.trim() !== "") return out;
  }
  return `top${orderIndex + 1}`;
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

export function createTopic(clientId: number, input: TopicInput): Topic {
  if (!input.name) throw new TopicError("name is required");
  const orderIndex = input.orderIndex ?? nextOrderIndex(clientId);

  const key =
    input.key ??
    generateTopicKey(
      clientId,
      {
        product: input.product ?? null,
        tag1: input.tag1 ?? null,
        tag2: input.tag2 ?? null,
        tag3: input.tag3 ?? null,
        tag4: input.tag4 ?? null,
      },
      orderIndex,
    );

  return db
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
    .returning()
    .get();
}

export function updateTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: TopicInput,
): { ok: true; row: Topic } | { ok: false; current: Topic | null } {
  const current = getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }

  const merged = { ...current, ...input } as Topic;
  let key = input.key ?? current.key;
  if (input.key === undefined && shouldRegenerateKey(current, input)) {
    key = generateTopicKey(
      clientId,
      {
        product: merged.product,
        tag1: merged.tag1,
        tag2: merged.tag2,
        tag3: merged.tag3,
        tag4: merged.tag4,
      },
      merged.orderIndex,
    );
  }

  const updated = db
    .update(topics)
    .set({
      ...input,
      key,
      version: sql`${topics.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

// Cascade archive: topic archive → also archives every message attached to
// this topic by key. Reporting NOT cascaded (history). Atomic via transaction.
export function archiveTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
):
  | { ok: true; row: Topic; cascadedMessageIds: number[] }
  | { ok: false; current: Topic | null } {
  const current = getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };

  return db.transaction((tx) => {
    const updated = tx
      .update(topics)
      .set({
        archivedAt: sql`CURRENT_TIMESTAMP`,
        version: sql`${topics.version} + 1`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
      .returning()
      .get();

    const cascadedMessages = tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.topic, current.key),
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
            eq(messages.topic, current.key),
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

export function restoreTopic(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Topic } | { ok: false; current: Topic | null } {
  const current = getTopic(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(topics)
    .set({
      archivedAt: null,
      version: sql`${topics.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(topics.clientId, clientId), eq(topics.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}
