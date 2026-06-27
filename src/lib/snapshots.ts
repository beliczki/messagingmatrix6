import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  audiences,
  creatives,
  messages,
  reporting,
  shareGalleries,
  snapshots,
  textFormatting,
  topics,
  uploadedFiles,
  users,
  type Snapshot,
} from "@/db/schema";

// Spec §17.13 / Phase 10b — point-in-time snapshot of all 10 tenant-scoped
// tables. NOT included: config, clients, system_config, audit_log.

export type SnapshotPayload = {
  audiences: Array<typeof audiences.$inferSelect>;
  topics: Array<typeof topics.$inferSelect>;
  messages: Array<typeof messages.$inferSelect>;
  assets: Array<typeof assets.$inferSelect>;
  creatives: Array<typeof creatives.$inferSelect>;
  textFormatting: Array<typeof textFormatting.$inferSelect>;
  reporting: Array<typeof reporting.$inferSelect>;
  shareGalleries: Array<typeof shareGalleries.$inferSelect>;
  uploadedFiles: Array<typeof uploadedFiles.$inferSelect>;
  users: Array<typeof users.$inferSelect>;
};

async function readAllTables(clientId: number): Promise<SnapshotPayload> {
  const [
    audiencesRows,
    topicsRows,
    messagesRows,
    assetsRows,
    creativesRows,
    textFormattingRows,
    reportingRows,
    shareGalleriesRows,
    uploadedFilesRows,
    usersRows,
  ] = await Promise.all([
    db.select().from(audiences).where(eq(audiences.clientId, clientId)),
    db.select().from(topics).where(eq(topics.clientId, clientId)),
    db.select().from(messages).where(eq(messages.clientId, clientId)),
    db.select().from(assets).where(eq(assets.clientId, clientId)),
    db.select().from(creatives).where(eq(creatives.clientId, clientId)),
    db.select().from(textFormatting).where(eq(textFormatting.clientId, clientId)),
    db.select().from(reporting).where(eq(reporting.clientId, clientId)),
    db.select().from(shareGalleries).where(eq(shareGalleries.clientId, clientId)),
    db.select().from(uploadedFiles).where(eq(uploadedFiles.clientId, clientId)),
    db.select().from(users).where(eq(users.clientId, clientId)),
  ]);
  return {
    audiences: audiencesRows,
    topics: topicsRows,
    messages: messagesRows,
    assets: assetsRows,
    creatives: creativesRows,
    textFormatting: textFormattingRows,
    reporting: reportingRows,
    shareGalleries: shareGalleriesRows,
    uploadedFiles: uploadedFilesRows,
    users: usersRows,
  };
}

export type SnapshotMeta = {
  id: number;
  label: string;
  createdBy: string | null;
  createdAt: string;
  // Per-table row counts for the listing UI.
  counts: Record<keyof SnapshotPayload, number>;
};

function metaFromRow(row: Snapshot): SnapshotMeta {
  let counts: Record<keyof SnapshotPayload, number>;
  try {
    const payload = JSON.parse(row.payloadJson) as SnapshotPayload;
    counts = {
      audiences: payload.audiences?.length ?? 0,
      topics: payload.topics?.length ?? 0,
      messages: payload.messages?.length ?? 0,
      assets: payload.assets?.length ?? 0,
      creatives: payload.creatives?.length ?? 0,
      textFormatting: payload.textFormatting?.length ?? 0,
      reporting: payload.reporting?.length ?? 0,
      shareGalleries: payload.shareGalleries?.length ?? 0,
      uploadedFiles: payload.uploadedFiles?.length ?? 0,
      users: payload.users?.length ?? 0,
    };
  } catch {
    counts = {
      audiences: 0,
      topics: 0,
      messages: 0,
      assets: 0,
      creatives: 0,
      textFormatting: 0,
      reporting: 0,
      shareGalleries: 0,
      uploadedFiles: 0,
      users: 0,
    };
  }
  return {
    id: row.id,
    label: row.label,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    counts,
  };
}

export async function listSnapshots(clientId: number): Promise<SnapshotMeta[]> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.clientId, clientId))
    // id tiebreaker: createdAt is second-precision text, so two snapshots made
    // in the same second tie — Postgres won't preserve insertion order on a tie
    // the way SQLite's rowid happened to. Newest id first keeps it deterministic.
    .orderBy(desc(snapshots.createdAt), desc(snapshots.id));
  return rows.map(metaFromRow);
}

export async function getSnapshot(
  clientId: number,
  id: number,
): Promise<Snapshot | null> {
  const rows = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.clientId, clientId), eq(snapshots.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSnapshot(
  clientId: number,
  label: string,
  createdBy: string | null,
): Promise<SnapshotMeta> {
  const payload = await readAllTables(clientId);
  const [inserted] = await db
    .insert(snapshots)
    .values({
      clientId,
      label,
      createdBy,
      payloadJson: JSON.stringify(payload),
    })
    .returning();
  return metaFromRow(inserted);
}

export async function deleteSnapshot(
  clientId: number,
  id: number,
): Promise<boolean> {
  const existing = await getSnapshot(clientId, id);
  if (!existing) return false;
  await db
    .delete(snapshots)
    .where(and(eq(snapshots.clientId, clientId), eq(snapshots.id, id)));
  return true;
}

// Wipe all 10 tenant-scoped tables for the client and re-insert from the
// snapshot payload. Atomic via transaction. Returns the snapshot meta on
// success or null if the snapshot doesn't exist for this client.
export async function restoreSnapshot(
  clientId: number,
  id: number,
): Promise<
  { ok: true; counts: Record<keyof SnapshotPayload, number> } | { ok: false }
> {
  const row = await getSnapshot(clientId, id);
  if (!row) return { ok: false };

  let payload: SnapshotPayload;
  try {
    payload = JSON.parse(row.payloadJson) as SnapshotPayload;
  } catch {
    return { ok: false };
  }

  await db.transaction(async (tx) => {
    // Wipe in dependency order (every table just FK's clients(id), so order
    // doesn't matter — but we keep a stable order for clarity).
    await tx.delete(reporting).where(eq(reporting.clientId, clientId));
    await tx.delete(messages).where(eq(messages.clientId, clientId));
    await tx.delete(textFormatting).where(eq(textFormatting.clientId, clientId));
    await tx.delete(creatives).where(eq(creatives.clientId, clientId));
    await tx.delete(assets).where(eq(assets.clientId, clientId));
    await tx.delete(topics).where(eq(topics.clientId, clientId));
    await tx.delete(audiences).where(eq(audiences.clientId, clientId));
    await tx.delete(shareGalleries).where(eq(shareGalleries.clientId, clientId));
    await tx.delete(uploadedFiles).where(eq(uploadedFiles.clientId, clientId));
    await tx.delete(users).where(eq(users.clientId, clientId));

    if (payload.audiences?.length) await tx.insert(audiences).values(payload.audiences);
    if (payload.topics?.length) await tx.insert(topics).values(payload.topics);
    if (payload.messages?.length) await tx.insert(messages).values(payload.messages);
    if (payload.assets?.length) await tx.insert(assets).values(payload.assets);
    if (payload.creatives?.length) await tx.insert(creatives).values(payload.creatives);
    if (payload.textFormatting?.length) await tx.insert(textFormatting).values(payload.textFormatting);
    if (payload.reporting?.length) await tx.insert(reporting).values(payload.reporting);
    if (payload.shareGalleries?.length) await tx.insert(shareGalleries).values(payload.shareGalleries);
    if (payload.uploadedFiles?.length) await tx.insert(uploadedFiles).values(payload.uploadedFiles);
    if (payload.users?.length) await tx.insert(users).values(payload.users);

    // We re-inserted rows with explicit integer ids, which does NOT advance
    // Postgres identity sequences — reset them so the next auto-insert can't
    // collide with a restored id. (SQLite advanced AUTOINCREMENT implicitly;
    // Postgres does not.) Text-id tables (users/shareGalleries/uploadedFiles)
    // have no sequence and are skipped.
    for (const t of [
      "audiences",
      "topics",
      "messages",
      "assets",
      "creatives",
      "text_formatting",
      "reporting",
    ]) {
      await tx.execute(
        sql`SELECT setval(pg_get_serial_sequence(${t}, 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${sql.raw(`"${t}"`)}), 1))`,
      );
    }
  });

  return {
    ok: true,
    counts: {
      audiences: payload.audiences?.length ?? 0,
      topics: payload.topics?.length ?? 0,
      messages: payload.messages?.length ?? 0,
      assets: payload.assets?.length ?? 0,
      creatives: payload.creatives?.length ?? 0,
      textFormatting: payload.textFormatting?.length ?? 0,
      reporting: payload.reporting?.length ?? 0,
      shareGalleries: payload.shareGalleries?.length ?? 0,
      uploadedFiles: payload.uploadedFiles?.length ?? 0,
      users: payload.users?.length ?? 0,
    },
  };
}
