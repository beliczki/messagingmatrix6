// Regenerate a topic's / audience's KEY from its configured pattern and carry
// every MC that references it along.
//
// Why this exists: updateTopic/updateAudience regenerate the key only while no
// message references it (the MC-guard). That guard is right — a tag edit must
// not silently rewrite the measurement identity of hundreds of live cards — but
// it is SILENT, so a tag4 edit on a populated topic leaves the key (and every
// PMMID built from it) stale with nothing to show for it. This is the explicit,
// preview-first way to close that gap.
//
// What it rewrites: the dimension row's key, each affected message's
// topic/audience key, and each message's PMMID + trafficking columns (the PMMID
// pattern embeds both keys).
//
// What it NEVER rewrites: feed_exports payloads, monitoring rows and audit
// snapshots. Those record what actually shipped / what a platform actually
// reported — rewriting them would falsify history. They are inputs to the
// blocker check instead: once an id has left the building, the rekey is refused
// rather than made to lie.
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  config,
  feedExports,
  messages,
  monitoring,
  nowUtc,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "@/db/schema";
import { regeneratedIdentity } from "@/lib/message-identity";
import { isPlaced, type PlacedMessage } from "@/lib/entities/messages";
import {
  generateAudienceKey,
  getAudience,
  listAudiences,
} from "@/lib/entities/audiences";
import { generateTopicKey, getTopic } from "@/lib/entities/topics";
import { type TraffickingPatterns } from "@/lib/trafficking";
import { writeAudit } from "@/lib/audit";
import { broadcast } from "@/lib/events";

export type Dimension = "audience" | "topic";
export type DimensionRow = Audience | Topic;

// Why the rekey cannot be applied. Empty list ⇒ safe.
export type RekeyBlocker =
  | { kind: "key_taken"; byId: number; byName: string }
  | {
      kind: "shipped_feed";
      feedExportId: number;
      product: string;
      feedVersion: number;
      uploadedAt: string;
    }
  | { kind: "monitoring_rows"; count: number };

export type RekeyPreview = {
  dimension: Dimension;
  id: number;
  name: string;
  currentKey: string;
  generatedKey: string;
  // false ⇒ the key already matches the pattern; applying would be a no-op.
  stale: boolean;
  mcCount: number;
  samplePmmidBefore: string | null;
  samplePmmidAfter: string | null;
  blockers: RekeyBlocker[];
};

export type RekeyResult =
  | { ok: true; row: DimensionRow; newKey: string; messageIds: number[] }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "version_mismatch"; current: DimensionRow }
  | { ok: false; reason: "not_stale"; preview: RekeyPreview }
  | { ok: false; reason: "blocked"; preview: RekeyPreview };

type ClientPatterns = { pmmid?: string; trafficking?: TraffickingPatterns };

async function readClientPatterns(clientId: number): Promise<ClientPatterns> {
  const [row] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .limit(1);
  if (!row) return {};
  try {
    return JSON.parse(row.value) as ClientPatterns;
  } catch {
    return {};
  }
}

/** The key this row's pattern would produce from its CURRENT field values. */
export async function generatedKeyFor(
  clientId: number,
  dimension: Dimension,
  row: DimensionRow,
): Promise<string> {
  if (dimension === "topic") {
    const t = row as Topic;
    return generateTopicKey(
      clientId,
      {
        product: t.product,
        tag1: t.tag1,
        tag2: t.tag2,
        tag3: t.tag3,
        tag4: t.tag4,
      },
      t.orderIndex,
    );
  }
  const a = row as Audience;
  return generateAudienceKey(
    clientId,
    {
      product: a.product,
      strategy: a.strategy,
      buyingPlatform: a.buyingPlatform,
      device: a.device,
      tag: a.tag,
    },
    a.orderIndex,
  );
}

function getRow(clientId: number, dimension: Dimension, id: number) {
  return dimension === "topic"
    ? getTopic(clientId, id)
    : getAudience(clientId, id);
}

const keyColumn = (dimension: Dimension) =>
  dimension === "topic" ? messages.topic : messages.audience;

// Placed rows only. This is not just a type narrowing: a DRAFT's `topic` is a
// SUGGESTED NAME, not a reference, and nothing stops it from happening to spell
// an existing topic key — at which point a rekey of that topic would sweep the
// draft along and try to regenerate an identity the draft does not have yet.
// A draft can never match on the audience side (it has none), so this cuts off
// the topic side too, where the collision is possible.
async function messagesOnKey(
  clientId: number,
  dimension: Dimension,
  key: string,
): Promise<PlacedMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(keyColumn(dimension), key),
        isNotNull(messages.audience),
      ),
    )
    .orderBy(messages.number, messages.variant);
  return rows.filter(isPlaced);
}

// A key already used by ANOTHER row of the same dimension. The auto-key paths
// suffix (`_2`) on collision; a rekey must not — silently landing on a
// different key than the pattern produced is exactly the kind of drift this
// feature exists to end.
async function keyTaken(
  clientId: number,
  dimension: Dimension,
  key: string,
  selfId: number,
): Promise<RekeyBlocker | null> {
  const table = dimension === "topic" ? topics : audiences;
  const [row] = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(and(eq(table.clientId, clientId), eq(table.key, key)))
    .limit(1);
  if (!row || row.id === selfId) return null;
  return { kind: "key_taken", byId: row.id, byName: row.name };
}

// Has this key already left the building? `strpos` (not LIKE) because keys
// contain `_`, which LIKE would treat as a wildcard and over-match.
async function shippedFeeds(
  clientId: number,
  key: string,
): Promise<RekeyBlocker[]> {
  const rows = await db
    .select({
      id: feedExports.id,
      product: feedExports.product,
      feedVersion: feedExports.feedVersion,
      uploadedAt: feedExports.uploadedToAdformAt,
    })
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, clientId),
        isNotNull(feedExports.uploadedToAdformAt),
        sql`strpos(${feedExports.payloadJson}, ${key}) > 0`,
      ),
    )
    .orderBy(feedExports.feedVersion);
  return rows.map((r) => ({
    kind: "shipped_feed" as const,
    feedExportId: r.id,
    product: r.product,
    feedVersion: r.feedVersion,
    uploadedAt: r.uploadedAt ?? "",
  }));
}

async function monitoringRows(
  clientId: number,
  dimension: Dimension,
  key: string,
): Promise<RekeyBlocker | null> {
  const col =
    dimension === "topic" ? monitoring.topicKey : monitoring.audienceKey;
  const [row] = await db
    .select({ n: count() })
    .from(monitoring)
    .where(and(eq(monitoring.clientId, clientId), eq(col, key)));
  const n = row?.n ?? 0;
  return n > 0 ? { kind: "monitoring_rows", count: n } : null;
}

/** Read-only: what would happen, and what stands in the way. */
export async function previewRekey(
  clientId: number,
  dimension: Dimension,
  id: number,
): Promise<RekeyPreview | null> {
  const row = await getRow(clientId, dimension, id);
  if (!row) return null;
  const generatedKey = await generatedKeyFor(clientId, dimension, row);
  const stale = generatedKey !== row.key;
  const affected = await messagesOnKey(clientId, dimension, row.key);

  let samplePmmidAfter: string | null = null;
  const sample = affected[0] ?? null;
  if (sample && stale) {
    const patterns = await readClientPatterns(clientId);
    const audienceList = await listAudiences(clientId);
    samplePmmidAfter = regeneratedIdentity(
      {
        audience: dimension === "audience" ? generatedKey : sample.audience,
        topic: dimension === "topic" ? generatedKey : sample.topic,
        number: sample.number,
        variant: sample.variant,
        versionNo: sample.versionNo,
        landingUrl: sample.landingUrl,
      },
      {
        audienceRow: null,
        topicRow: null,
        patterns,
        audienceList,
      },
    ).pmmid;
  }

  const blockers: RekeyBlocker[] = [];
  if (stale) {
    const taken = await keyTaken(clientId, dimension, generatedKey, id);
    if (taken) blockers.push(taken);
    if (affected.length > 0) {
      blockers.push(...(await shippedFeeds(clientId, row.key)));
      const mon = await monitoringRows(clientId, dimension, row.key);
      if (mon) blockers.push(mon);
    }
  }

  return {
    dimension,
    id,
    name: row.name,
    currentKey: row.key,
    generatedKey,
    stale,
    mcCount: affected.length,
    samplePmmidBefore: sample?.pmmid ?? null,
    samplePmmidAfter,
    blockers,
  };
}

/**
 * Apply the rekey: dimension key + every referencing MC's key, PMMID and
 * trafficking, in one transaction. Per-MC audit rows (so each card keeps its
 * own history) but a single SSE broadcast, not one per row.
 */
export async function rekeyDimension(
  clientId: number,
  dimension: Dimension,
  id: number,
  expectedVersion: number,
  userId: string | null,
): Promise<RekeyResult> {
  const current = await getRow(clientId, dimension, id);
  if (!current) return { ok: false, reason: "not_found" };
  if (current.version !== expectedVersion) {
    return { ok: false, reason: "version_mismatch", current };
  }
  const preview = await previewRekey(clientId, dimension, id);
  if (!preview) return { ok: false, reason: "not_found" };
  if (!preview.stale) return { ok: false, reason: "not_stale", preview };
  if (preview.blockers.length > 0) {
    return { ok: false, reason: "blocked", preview };
  }

  const newKey = preview.generatedKey;
  const patterns = await readClientPatterns(clientId);
  const audienceList = await listAudiences(clientId);
  const table = dimension === "topic" ? topics : audiences;

  const messageIds: number[] = [];
  let updatedRow: DimensionRow = current;

  await db.transaction(async () => {
    const [dimRow] = await db
      .update(table)
      .set({
        key: newKey,
        version: sql`${table.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(table.clientId, clientId), eq(table.id, id)))
      .returning();
    updatedRow = dimRow;
    await writeAudit({
      clientId,
      userId,
      entityType: dimension === "topic" ? "topics" : "audiences",
      entityId: id,
      action: "update",
      before: current,
      after: dimRow,
      silent: true,
    });

    // The dimension row is the audience/topic these messages resolve through,
    // so it is passed as the freshly-renamed row rather than re-read by key.
    const affected = await messagesOnKey(clientId, dimension, current.key);
    for (const before of affected) {
      const identity = regeneratedIdentity(
        {
          audience: dimension === "audience" ? newKey : before.audience,
          topic: dimension === "topic" ? newKey : before.topic,
          number: before.number,
          variant: before.variant,
          versionNo: before.versionNo,
          landingUrl: before.landingUrl,
        },
        {
          audienceRow:
            dimension === "audience"
              ? (dimRow as Audience)
              : await audienceFor(clientId, before.audience),
          topicRow:
            dimension === "topic"
              ? (dimRow as Topic)
              : await topicFor(clientId, before.topic),
          patterns,
          audienceList,
        },
      );
      const keyPatch =
        dimension === "topic" ? { topic: newKey } : { audience: newKey };
      const [after] = await db
        .update(messages)
        .set({
          ...keyPatch,
          ...identity,
          version: sql`${messages.version} + 1`,
          updatedAt: nowUtc,
        })
        .where(and(eq(messages.clientId, clientId), eq(messages.id, before.id)))
        .returning();
      await writeAudit({
        clientId,
        userId,
        entityType: "messages",
        entityId: before.id,
        action: "update",
        before,
        after,
        silent: true,
      });
      messageIds.push(before.id);
    }
  });

  broadcast(clientId, {
    entity: dimension === "topic" ? "topics" : "audiences",
    ids: [id],
    action: "update",
    byUser: userId,
  });
  if (messageIds.length > 0) {
    broadcast(clientId, {
      entity: "messages",
      ids: messageIds,
      action: "bulk_update",
      byUser: userId,
    });
  }

  return { ok: true, row: updatedRow, newKey, messageIds };
}

async function audienceFor(
  clientId: number,
  key: string,
): Promise<Audience | null> {
  const [row] = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
    .limit(1);
  return row ?? null;
}

async function topicFor(clientId: number, key: string): Promise<Topic | null> {
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
    .limit(1);
  return row ?? null;
}
