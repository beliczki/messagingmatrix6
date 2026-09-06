import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  channels,
  nowUtc,
  type Audience,
  type Channel,
} from "@/db/schema";

// Agentic channels are first-class, separate from audiences. An Agentic message
// still stores the channel KEY in messages.audience (e.g. "ch_disp") — the
// key namespace is shared — so channel placements resolve through the same
// audience-key code paths (numbering, pmmid, trafficking, matrix columns) by
// exposing each channel in the shape of an Audience. See channelToAudience.

export async function listChannels(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Channel[]> {
  const where = opts.includeArchived
    ? eq(channels.clientId, clientId)
    : and(eq(channels.clientId, clientId), isNull(channels.archivedAt));
  return db.select().from(channels).where(where).orderBy(asc(channels.orderIndex));
}

export async function findChannelByKey(
  clientId: number,
  key: string,
): Promise<Channel | null> {
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.clientId, clientId), eq(channels.key, key)))
    .limit(1);
  return row ?? null;
}

export async function findChannelByCode(
  clientId: number,
  code: string,
): Promise<Channel | null> {
  const [row] = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.clientId, clientId),
        eq(channels.code, code),
        isNull(channels.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Present a channel as an Audience so the shared audience-key code paths
// (createMessage numbering/pmmid/trafficking, matrix column derivation) treat
// it exactly as the old channel-audience rows did: channel = the prodlist code
// (non-null ⇒ Agentic axis), every targeting/trafficking column null (channel
// audiences never carried them). id/clientId/timestamps come from the channel;
// nothing downstream keys off them.
export function channelToAudience(c: Channel): Audience {
  return {
    id: c.id,
    clientId: c.clientId,
    key: c.key,
    name: c.label,
    orderIndex: c.orderIndex,
    status: null,
    product: null,
    strategy: null,
    buyingPlatform: null,
    dataSource: null,
    targetingType: null,
    device: null,
    tag: null,
    comment: null,
    campaignName: null,
    campaignId: null,
    lineitemName: null,
    lineitemId: null,
    channel: c.code,
    version: 1,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    archivedAt: c.archivedAt,
  };
}

// ── CRUD (Settings › Channels) ──────────────────────────────────────────────

export async function createChannel(
  clientId: number,
  input: { key: string; code: string; label: string },
): Promise<Channel> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${channels.orderIndex}), -1)` })
    .from(channels)
    .where(eq(channels.clientId, clientId));
  const [row] = await db
    .insert(channels)
    .values({
      clientId,
      key: input.key,
      code: input.code,
      label: input.label,
      orderIndex: (max ?? -1) + 1,
    })
    .returning();
  return row;
}

export async function updateChannel(
  clientId: number,
  id: number,
  patch: Partial<{ code: string; label: string; orderIndex: number }>,
): Promise<Channel | null> {
  const [row] = await db
    .update(channels)
    .set({ ...patch, updatedAt: nowUtc })
    .where(and(eq(channels.clientId, clientId), eq(channels.id, id)))
    .returning();
  return row ?? null;
}

export async function archiveChannel(
  clientId: number,
  id: number,
): Promise<Channel | null> {
  const [row] = await db
    .update(channels)
    .set({ archivedAt: nowUtc, updatedAt: nowUtc })
    .where(and(eq(channels.clientId, clientId), eq(channels.id, id)))
    .returning();
  return row ?? null;
}

export async function restoreChannel(
  clientId: number,
  id: number,
): Promise<Channel | null> {
  const [row] = await db
    .update(channels)
    .set({ archivedAt: null, updatedAt: nowUtc })
    .where(and(eq(channels.clientId, clientId), eq(channels.id, id)))
    .returning();
  return row ?? null;
}

// ── One-time data migration: channel-audiences → channels ───────────────────

// Move the legacy `audiences.channel != null` rows into the channels table,
// then hard-delete them from audiences so the audiences list is DCO-only. The
// channel KEY strings are preserved, so the 826 Agentic messages (which store
// audience = "ch_disp" etc.) keep resolving — now via the channels table.
// Idempotent: a channel already present (matched on key) is left untouched, and
// a second run finds no channel-audiences to move. Returns {seeded, deleted}.
export async function migrateChannelsFromAudiences(
  clientId: number,
): Promise<{ seeded: number; deleted: number }> {
  const legacy = await db
    .select()
    .from(audiences)
    .where(
      and(eq(audiences.clientId, clientId), isNotNull(audiences.channel)),
    )
    .orderBy(asc(audiences.orderIndex));
  if (legacy.length === 0) return { seeded: 0, deleted: 0 };

  const existing = await listChannels(clientId, { includeArchived: true });
  const haveKeys = new Set(existing.map((c) => c.key));

  let seeded = 0;
  let orderBase = existing.reduce((m, c) => Math.max(m, c.orderIndex), -1);
  for (const a of legacy) {
    if (haveKeys.has(a.key)) continue;
    orderBase += 1;
    await db.insert(channels).values({
      clientId,
      key: a.key,
      code: a.channel!,
      label: a.name,
      orderIndex: orderBase,
      archivedAt: a.archivedAt,
    });
    seeded++;
  }

  const del = await db
    .delete(audiences)
    .where(
      and(eq(audiences.clientId, clientId), isNotNull(audiences.channel)),
    )
    .returning({ id: audiences.id });

  return { seeded, deleted: del.length };
}
