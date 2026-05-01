import { and, desc, eq } from "drizzle-orm";
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

function readAllTables(clientId: number): SnapshotPayload {
  return {
    audiences: db.select().from(audiences).where(eq(audiences.clientId, clientId)).all(),
    topics: db.select().from(topics).where(eq(topics.clientId, clientId)).all(),
    messages: db.select().from(messages).where(eq(messages.clientId, clientId)).all(),
    assets: db.select().from(assets).where(eq(assets.clientId, clientId)).all(),
    creatives: db.select().from(creatives).where(eq(creatives.clientId, clientId)).all(),
    textFormatting: db.select().from(textFormatting).where(eq(textFormatting.clientId, clientId)).all(),
    reporting: db.select().from(reporting).where(eq(reporting.clientId, clientId)).all(),
    shareGalleries: db.select().from(shareGalleries).where(eq(shareGalleries.clientId, clientId)).all(),
    uploadedFiles: db.select().from(uploadedFiles).where(eq(uploadedFiles.clientId, clientId)).all(),
    users: db.select().from(users).where(eq(users.clientId, clientId)).all(),
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

export function listSnapshots(clientId: number): SnapshotMeta[] {
  const rows = db
    .select()
    .from(snapshots)
    .where(eq(snapshots.clientId, clientId))
    .orderBy(desc(snapshots.createdAt))
    .all();
  return rows.map(metaFromRow);
}

export function getSnapshot(clientId: number, id: number): Snapshot | null {
  return (
    db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.clientId, clientId), eq(snapshots.id, id)))
      .get() ?? null
  );
}

export function createSnapshot(
  clientId: number,
  label: string,
  createdBy: string | null,
): SnapshotMeta {
  const payload = readAllTables(clientId);
  const inserted = db
    .insert(snapshots)
    .values({
      clientId,
      label,
      createdBy,
      payloadJson: JSON.stringify(payload),
    })
    .returning()
    .get();
  return metaFromRow(inserted);
}

export function deleteSnapshot(clientId: number, id: number): boolean {
  const existing = getSnapshot(clientId, id);
  if (!existing) return false;
  db.delete(snapshots)
    .where(and(eq(snapshots.clientId, clientId), eq(snapshots.id, id)))
    .run();
  return true;
}

// Wipe all 10 tenant-scoped tables for the client and re-insert from the
// snapshot payload. Atomic via transaction. Returns the snapshot meta on
// success or null if the snapshot doesn't exist for this client.
export function restoreSnapshot(
  clientId: number,
  id: number,
): { ok: true; counts: Record<keyof SnapshotPayload, number> } | { ok: false } {
  const row = getSnapshot(clientId, id);
  if (!row) return { ok: false };

  let payload: SnapshotPayload;
  try {
    payload = JSON.parse(row.payloadJson) as SnapshotPayload;
  } catch {
    return { ok: false };
  }

  db.transaction((tx) => {
    // Wipe in dependency order (deepest children first if FKs cascaded; here
    // every table just FK's clients(id), so order doesn't matter — but we keep
    // a stable order for clarity in the audit log).
    tx.delete(reporting).where(eq(reporting.clientId, clientId)).run();
    tx.delete(messages).where(eq(messages.clientId, clientId)).run();
    tx.delete(textFormatting).where(eq(textFormatting.clientId, clientId)).run();
    tx.delete(creatives).where(eq(creatives.clientId, clientId)).run();
    tx.delete(assets).where(eq(assets.clientId, clientId)).run();
    tx.delete(topics).where(eq(topics.clientId, clientId)).run();
    tx.delete(audiences).where(eq(audiences.clientId, clientId)).run();
    tx.delete(shareGalleries).where(eq(shareGalleries.clientId, clientId)).run();
    tx.delete(uploadedFiles).where(eq(uploadedFiles.clientId, clientId)).run();
    tx.delete(users).where(eq(users.clientId, clientId)).run();

    if (payload.audiences?.length) tx.insert(audiences).values(payload.audiences).run();
    if (payload.topics?.length) tx.insert(topics).values(payload.topics).run();
    if (payload.messages?.length) tx.insert(messages).values(payload.messages).run();
    if (payload.assets?.length) tx.insert(assets).values(payload.assets).run();
    if (payload.creatives?.length) tx.insert(creatives).values(payload.creatives).run();
    if (payload.textFormatting?.length) tx.insert(textFormatting).values(payload.textFormatting).run();
    if (payload.reporting?.length) tx.insert(reporting).values(payload.reporting).run();
    if (payload.shareGalleries?.length) tx.insert(shareGalleries).values(payload.shareGalleries).run();
    if (payload.uploadedFiles?.length) tx.insert(uploadedFiles).values(payload.uploadedFiles).run();
    if (payload.users?.length) tx.insert(users).values(payload.users).run();
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
