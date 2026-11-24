// What a share gallery freezes into `metadata`, and how a selection from the
// creative library becomes (part of) one. Two callers: creating a share and
// adding to an existing one — they must resolve a selection identically, or a
// share built in two steps would differ from the same share built in one.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  creatives,
  messagePreviews,
  messages,
  nowUtc,
  shareComments,
  shareGalleries,
  uploadedFiles,
} from "@/db/schema";
import { readTemplate } from "@/lib/templates";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";
import { versionFamilyKey } from "@/lib/group-creative-versions";
import { getActiveClient } from "@/lib/active-client";
import { warmStills } from "@/lib/video-stills";
import { ensureSecret, signTokenWith } from "@/lib/public-shortcut";
import { creativeMediaKind, type CreativeMediaKind } from "@/lib/creative-media-kind";
import {
  sharePreviewGroups,
  shareSearchText,
  type PreviewGroup,
  type SnapshotLike,
} from "@/lib/share-list";

type SnapshotFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

export type SnapshotMetadata = {
  generatedAt: string;
  messages: Array<typeof messages.$inferSelect>;
  /** (messageId, size) pairs the user picked — drives the public renderer. */
  matrixItems?: Array<{ messageId: number; size: string }>;
  creatives?: Array<typeof creatives.$inferSelect>;
  /** Library assets (logos, backgrounds, clips) — shown after the creatives. */
  assets?: Array<typeof assets.$inferSelect>;
  files?: SnapshotFile[];
};

export type ShareSelectionInput = {
  mcIds: number[];
  matrix: Array<{ messageId: number; size: string }>;
  creativeIds: number[];
  assetIds: number[];
};

/** Reads the selection fields of a create / add-items request body. */
export function parseShareSelection(body: unknown): ShareSelectionInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const mcIds = Array.isArray(o.mcIds)
    ? o.mcIds.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];
  const matrix: Array<{ messageId: number; size: string }> = Array.isArray(
    o.matrix,
  )
    ? (o.matrix as Array<unknown>)
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const r = p as Record<string, unknown>;
          const id = Number(r.messageId);
          const size = typeof r.size === "string" ? r.size : null;
          if (!Number.isFinite(id) || !size) return null;
          return { messageId: id, size };
        })
        .filter((x): x is { messageId: number; size: string } => x !== null)
    : [];
  const creativeIds = Array.isArray(o.creativeIds)
    ? o.creativeIds.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];
  const assetIds = Array.isArray(o.assetIds)
    ? o.assetIds.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];
  return { mcIds, matrix, creativeIds, assetIds };
}

export function isEmptySelection(s: ShareSelectionInput): boolean {
  return (
    s.mcIds.length === 0 &&
    s.matrix.length === 0 &&
    s.creativeIds.length === 0 &&
    s.assetIds.length === 0
  );
}

/** A selection resolved against this client's rows — the snapshot's parts. */
export type ResolvedSelection = Omit<SnapshotMetadata, "generatedAt"> & {
  matrixItems: Array<{ messageId: number; size: string }>;
  creatives: Array<typeof creatives.$inferSelect>;
  assets: Array<typeof assets.$inferSelect>;
  files: SnapshotFile[];
};

export async function resolveShareSelection(
  clientId: number,
  input: ShareSelectionInput,
): Promise<ResolvedSelection> {
  const { mcIds, matrix: matrixPairsIn, creativeIds, assetIds } = input;

  // Resolve all referenced message ids — both the size-aware `matrix` pairs
  // and the legacy `mcIds` (which need a default size resolved server-side
  // from the template registry).
  const allMessageIds = Array.from(
    new Set([...mcIds, ...matrixPairsIn.map((p) => p.messageId)]),
  );
  const messageRows = allMessageIds.length
    ? await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.clientId, clientId), inArray(messages.id, allMessageIds)),
        )
    : [];

  // Fan out legacy mcIds → matrix pairs by defaulting each to the message's
  // template defaultSize (or the first available size).
  const messageById = new Map(messageRows.map((m) => [m.id, m]));
  const fannedFromMcIds: Array<{ messageId: number; size: string }> = [];
  for (const id of mcIds) {
    const m = messageById.get(id);
    if (!m || !m.template) continue;
    const tinfo = readTemplate(m.template);
    const size = tinfo?.defaultSize ?? tinfo?.sizes[0] ?? null;
    if (!size) continue;
    fannedFromMcIds.push({ messageId: id, size });
  }
  // Dedupe (messageId, size) pairs across both inputs.
  const matrixSeen = new Set<string>();
  const matrixItems: Array<{ messageId: number; size: string }> = [];
  for (const p of [...matrixPairsIn, ...fannedFromMcIds]) {
    if (!messageById.has(p.messageId)) continue;
    const k = `${p.messageId}|${p.size}`;
    if (matrixSeen.has(k)) continue;
    matrixSeen.add(k);
    matrixItems.push(p);
  }
  const creativeRowsUnordered = creativeIds.length
    ? await db
        .select()
        .from(creatives)
        .where(
          and(eq(creatives.clientId, clientId), inArray(creatives.id, creativeIds)),
        )
    : [];
  // `IN (...)` carries no order, so the rows came back in whatever order the
  // plan produced — which read as random in the share and had nothing to do
  // with what the person had arranged on screen. The caller sends the ids in
  // display order; the snapshot is written in that order.
  const creativePosition = new Map(creativeIds.map((id, i) => [id, i]));
  const creativeRows = creativeRowsUnordered.sort(
    (a, b) =>
      (creativePosition.get(a.id) ?? 0) - (creativePosition.get(b.id) ?? 0),
  );

  // Same ordering problem and answer as the creatives above.
  const assetRowsUnordered = assetIds.length
    ? await db
        .select()
        .from(assets)
        .where(and(eq(assets.clientId, clientId), inArray(assets.id, assetIds)))
    : [];
  const assetPosition = new Map(assetIds.map((id, i) => [id, i]));
  const assetRows = assetRowsUnordered.sort(
    (a, b) => (assetPosition.get(a.id) ?? 0) - (assetPosition.get(b.id) ?? 0),
  );

  // Snapshot file metadata for any creative or asset that references one — the
  // public share viewer cannot hit the auth-gated /api/files endpoints, so we
  // expose these via a share-scoped proxy that checks the file id is in this list.
  const fileIds = Array.from(
    new Set(
      [...creativeRows, ...assetRows].map((c) => c.fileId).filter((s): s is string => !!s),
    ),
  );
  const fileRows = fileIds.length
    ? await db
        .select({
          id: uploadedFiles.id,
          filename: uploadedFiles.filename,
          mimeType: uploadedFiles.mimeType,
          sizeBytes: uploadedFiles.sizeBytes,
          dimensions: uploadedFiles.dimensions,
        })
        .from(uploadedFiles)
        .where(
          and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, fileIds)),
        )
    : [];

  return {
    messages: messageRows,
    matrixItems,
    creatives: creativeRows,
    assets: assetRows,
    files: fileRows,
  };
}

/**
 * Appends a resolved selection to an existing snapshot. What the share already
 * holds keeps its place (and its comments, which are keyed by item); new items
 * go at the end of their group. An item already in the share is skipped, not
 * moved.
 */
export function appendToSnapshot(
  existing: SnapshotMetadata,
  add: ResolvedSelection,
): { metadata: SnapshotMetadata; added: number; skipped: number } {
  const matrixItems = [...(existing.matrixItems ?? [])];
  const matrixSeen = new Set(matrixItems.map((p) => `${p.messageId}|${p.size}`));
  const creativeRows = [...(existing.creatives ?? [])];
  const creativeSeen = new Set(creativeRows.map((c) => c.id));
  let added = 0;
  let skipped = 0;

  for (const p of add.matrixItems) {
    const k = `${p.messageId}|${p.size}`;
    if (matrixSeen.has(k)) {
      skipped++;
      continue;
    }
    matrixSeen.add(k);
    matrixItems.push(p);
    added++;
  }
  for (const c of add.creatives) {
    if (creativeSeen.has(c.id)) {
      skipped++;
      continue;
    }
    creativeSeen.add(c.id);
    creativeRows.push(c);
    added++;
  }
  const assetRows = [...(existing.assets ?? [])];
  const assetSeen = new Set(assetRows.map((a) => a.id));
  for (const a of add.assets) {
    if (assetSeen.has(a.id)) {
      skipped++;
      continue;
    }
    assetSeen.add(a.id);
    assetRows.push(a);
    added++;
  }

  // Message and file rows are lookup tables for the items above, so they only
  // need to be present once — the existing (frozen) row wins.
  const messageRows = [...existing.messages];
  const messageSeen = new Set(messageRows.map((m) => m.id));
  for (const m of add.messages) {
    if (messageSeen.has(m.id)) continue;
    messageSeen.add(m.id);
    messageRows.push(m);
  }
  const fileRows = [...(existing.files ?? [])];
  const fileSeen = new Set(fileRows.map((f) => f.id));
  for (const f of add.files) {
    if (fileSeen.has(f.id)) continue;
    fileSeen.add(f.id);
    fileRows.push(f);
  }

  return {
    metadata: {
      generatedAt: existing.generatedAt,
      messages: messageRows,
      matrixItems,
      creatives: creativeRows,
      assets: assetRows,
      files: fileRows,
    },
    added,
    skipped,
  };
}

export type AddToShareResult =
  | { ok: true; added: number; skipped: number; title: string | null; newFileIds: string[] }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Adds a resolved selection to a live share of this client. Read and write are
 * one transaction with the row locked: two people adding to the same share at
 * once would otherwise each write their own copy of the snapshot, and the
 * second write would drop the first one's items.
 */
export async function addToShare(
  clientId: number,
  shareId: string,
  add: ResolvedSelection,
): Promise<AddToShareResult> {
  return db.transaction(async (tx) => {
    const [share] = await tx
      .select()
      .from(shareGalleries)
      .where(and(eq(shareGalleries.clientId, clientId), eq(shareGalleries.id, shareId)))
      .for("update");
    if (!share) return { ok: false, status: 404, error: "share not found" };
    if (share.archivedAt !== null) {
      return { ok: false, status: 409, error: "share is archived" };
    }
    const existing = JSON.parse(share.metadata ?? "null") as SnapshotMetadata | null;
    if (!existing) return { ok: false, status: 409, error: "share has no snapshot" };

    const before = new Set((existing.files ?? []).map((f) => f.id));
    const { metadata, added, skipped } = appendToSnapshot(existing, add);
    if (added > 0) {
      await tx
        .update(shareGalleries)
        .set({ metadata: JSON.stringify(metadata), updatedAt: nowUtc })
        .where(eq(shareGalleries.id, shareId));
    }
    return {
      ok: true,
      added,
      skipped,
      title: share.title,
      newFileIds: (metadata.files ?? []).map((f) => f.id).filter((id) => !before.has(id)),
    };
  });
}

type CreativeRow = typeof creatives.$inferSelect;

/**
 * Which of a share's creatives a refresh swaps for a newer version of itself,
 * and the creative list after the swaps. ONE function for the refresh and for
 * its preview in the confirm dialog (user request 2026-11-20: show what will be
 * swapped, with thumbnails) — so the dialog cannot promise a swap the refresh
 * then does not make. `current` is the share's creatives as they are now: the
 * live row by id, the frozen copy where the row is gone.
 */
async function planVersionSwaps(
  q: Pick<typeof db, "select">,
  clientId: number,
  current: CreativeRow[],
): Promise<{ rows: CreativeRow[]; replaced: Array<{ from: CreativeRow; to: CreativeRow }> }> {
  // A family's versions share the MC number, so the candidates are read by it
  // (indexed) — not the client's whole library, which is thousands of rows.
  // Both the column and the filename's own MC number are asked for, in case
  // one was edited apart from the other.
  const mcNumbers = new Set<number>();
  for (const c of current) {
    if (c.mcNumber !== null) mcNumbers.add(c.mcNumber);
    const fromName = c.fileName ? parseCreativeFilename(c.fileName).mcNumber : null;
    if (fromName !== null) mcNumbers.add(fromName);
  }
  const candidates = mcNumbers.size
    ? await q
        .select()
        .from(creatives)
        .where(
          and(
            eq(creatives.clientId, clientId),
            inArray(creatives.mcNumber, [...mcNumbers]),
            isNull(creatives.archivedAt),
          ),
        )
    : [];
  // The newest live version per family; within one version the latest upload.
  const newest = new Map<string, { row: CreativeRow; version: number }>();
  for (const row of candidates) {
    const family = row.fileName ? versionFamilyKey(row.fileName) : null;
    if (!family) continue;
    const best = newest.get(family.key);
    const newer =
      !best ||
      family.version > best.version ||
      (family.version === best.version &&
        (row.createdAt > best.row.createdAt ||
          (row.createdAt === best.row.createdAt && row.id > best.row.id)));
    if (newer) newest.set(family.key, { row, version: family.version });
  }
  const replaced: Array<{ from: CreativeRow; to: CreativeRow }> = [];
  const rows: CreativeRow[] = [];
  const inShare = new Set<number>();
  for (const c of current) {
    const family = c.fileName ? versionFamilyKey(c.fileName) : null;
    const best = family ? newest.get(family.key) : undefined;
    const row = best && family && best.version > family.version ? best.row : c;
    if (row.id !== c.id) replaced.push({ from: c, to: row });
    // The newer version is already in the share (added by hand, or another
    // old version swapped to it first): one tile, at the first place.
    if (inShare.has(row.id)) continue;
    inShare.add(row.id);
    rows.push(row);
  }
  return { rows, replaced };
}

export type RefreshPreviewItem = {
  id: number;
  fileName: string | null;
  fileId: string | null;
  kind: CreativeMediaKind;
};

export type ShareRefreshPreview =
  | { ok: true; replaced: Array<{ from: RefreshPreviewItem; to: RefreshPreviewItem }> }
  | { ok: false; status: 404 | 409; error: string };

/**
 * What a refresh of this share would swap, for the confirm dialog — read only,
 * nothing is written. The same refusals as refreshShare, so the dialog never
 * offers a refresh the server will turn down.
 */
export async function previewShareRefresh(
  clientId: number,
  shareId: string,
): Promise<ShareRefreshPreview> {
  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(and(eq(shareGalleries.clientId, clientId), eq(shareGalleries.id, shareId)));
  if (!share) return { ok: false, status: 404, error: "share not found" };
  if (share.archivedAt !== null) {
    return { ok: false, status: 409, error: "share is archived" };
  }
  const existing = JSON.parse(share.metadata ?? "null") as SnapshotMetadata | null;
  if (!existing) return { ok: false, status: 409, error: "share has no snapshot" };

  const frozen = existing.creatives ?? [];
  const live = frozen.length
    ? await db
        .select()
        .from(creatives)
        .where(
          and(
            eq(creatives.clientId, clientId),
            inArray(
              creatives.id,
              frozen.map((c) => c.id),
            ),
          ),
        )
    : [];
  const liveById = new Map(live.map((r) => [r.id, r]));
  const { replaced } = await planVersionSwaps(
    db,
    clientId,
    frozen.map((c) => liveById.get(c.id) ?? c),
  );

  // The stored mime decides what a file is (creativeMediaKind) — a zip gets
  // its poster, not an <img> of the archive.
  const fileIds = replaced
    .flatMap((s) => [s.from.fileId, s.to.fileId])
    .filter((id): id is string => !!id);
  const files = fileIds.length
    ? await db
        .select({ id: uploadedFiles.id, mimeType: uploadedFiles.mimeType })
        .from(uploadedFiles)
        .where(and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, fileIds)))
    : [];
  const mimeById = new Map(files.map((f) => [f.id, f.mimeType]));
  const item = (c: CreativeRow): RefreshPreviewItem => ({
    id: c.id,
    fileName: c.fileName,
    fileId: c.fileId,
    kind: creativeMediaKind(c.fileId ? mimeById.get(c.fileId) : null, c.fileName),
  });
  return {
    ok: true,
    replaced: replaced.map((s) => ({ from: item(s.from), to: item(s.to) })),
  };
}

export type RefreshShareResult =
  | {
      ok: true;
      changed: number;
      /** Creatives swapped for a newer version of themselves (n1 → n2). */
      replaced: Array<{ from: number; to: number }>;
      /** Files the share did not hold before — the newer versions' — to warm. */
      newFileIds: string[];
      title: string | null;
    }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Brings a share's frozen rows up to what the MCs and creatives are now — the
 * content, text styles and custom CSS edited since the share was made. The
 * lookup rows (messages, creatives, assets, files) are swapped by id: the items,
 * their order and the comments keyed by them stay. A row that no longer exists
 * keeps its frozen copy, so a deletion never punches a hole in a sent link.
 * Locked like addToShare, so a refresh and an add cannot drop each other's write.
 *
 * "What the creatives are now" includes a newer delivery (user request,
 * 2026-11-20: the n2 of two sizes should come into the same link). A newer
 * version is a creative row of its own with its own id, so re-reading by id
 * alone never found it. Each creative is swapped, in its place, for the newest
 * live version of its family — the library's own family key (filename minus
 * `_nN`, plus the declared size; a zip is its own family). Its comments move
 * with it (user decision 2026-11-20), or they would vanish from the link. Only
 * a HIGHER `_nN` replaces: an archived n2 must not send the share back to n1.
 */
export async function refreshShare(
  clientId: number,
  shareId: string,
): Promise<RefreshShareResult> {
  return db.transaction(async (tx) => {
    const [share] = await tx
      .select()
      .from(shareGalleries)
      .where(and(eq(shareGalleries.clientId, clientId), eq(shareGalleries.id, shareId)))
      .for("update");
    if (!share) return { ok: false, status: 404, error: "share not found" };
    if (share.archivedAt !== null) {
      return { ok: false, status: 409, error: "share is archived" };
    }
    const existing = JSON.parse(share.metadata ?? "null") as SnapshotMetadata | null;
    if (!existing) return { ok: false, status: 409, error: "share has no snapshot" };

    const messageIds = existing.messages.map((m) => m.id);
    const liveMessages = messageIds.length
      ? await tx
          .select()
          .from(messages)
          .where(and(eq(messages.clientId, clientId), inArray(messages.id, messageIds)))
      : [];
    const creativeIds = (existing.creatives ?? []).map((c) => c.id);
    const liveCreatives = creativeIds.length
      ? await tx
          .select()
          .from(creatives)
          .where(and(eq(creatives.clientId, clientId), inArray(creatives.id, creativeIds)))
      : [];
    const assetIds = (existing.assets ?? []).map((a) => a.id);
    const liveAssets = assetIds.length
      ? await tx
          .select()
          .from(assets)
          .where(and(eq(assets.clientId, clientId), inArray(assets.id, assetIds)))
      : [];
    const fileIds = (existing.files ?? []).map((f) => f.id);
    const liveFiles = fileIds.length
      ? await tx
          .select({
            id: uploadedFiles.id,
            filename: uploadedFiles.filename,
            mimeType: uploadedFiles.mimeType,
            sizeBytes: uploadedFiles.sizeBytes,
            dimensions: uploadedFiles.dimensions,
          })
          .from(uploadedFiles)
          .where(and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, fileIds)))
      : [];

    let changed = 0;
    function overlay<T extends { id: number | string }>(frozen: T[], live: T[]): T[] {
      const byId = new Map(live.map((r) => [r.id, r]));
      return frozen.map((row) => {
        const now = byId.get(row.id);
        if (!now) return row;
        if (JSON.stringify(now) !== JSON.stringify(row)) changed++;
        return now;
      });
    }
    const refreshedCreatives = overlay(existing.creatives ?? [], liveCreatives);
    const refreshedAssets = overlay(existing.assets ?? [], liveAssets);

    const swaps = await planVersionSwaps(tx, clientId, refreshedCreatives);
    const creativeRows = swaps.rows;
    const replaced = swaps.replaced.map((s) => ({ from: s.from.id, to: s.to.id }));

    // The files are the items' lookup table: the newer versions' files come in,
    // and a replaced version's file leaves — the link should not keep serving
    // the n1 that was swapped out.
    const referenced = new Set(
      [...creativeRows, ...refreshedAssets]
        .map((r) => r.fileId)
        .filter((id): id is string => !!id),
    );
    const replacedFrom = new Set(replaced.map((r) => r.from));
    const leaving = new Set(
      refreshedCreatives
        .filter((c) => replacedFrom.has(c.id) && c.fileId && !referenced.has(c.fileId))
        .map((c) => c.fileId!),
    );
    const refreshedFiles = overlay(existing.files ?? [], liveFiles).filter(
      (f) => !leaving.has(f.id),
    );
    const held = new Set(refreshedFiles.map((f) => f.id));
    const newFileIds = [...referenced].filter((id) => !held.has(id));
    const newFiles = newFileIds.length
      ? await tx
          .select({
            id: uploadedFiles.id,
            filename: uploadedFiles.filename,
            mimeType: uploadedFiles.mimeType,
            sizeBytes: uploadedFiles.sizeBytes,
            dimensions: uploadedFiles.dimensions,
          })
          .from(uploadedFiles)
          .where(
            and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, newFileIds)),
          )
      : [];

    // Comments are keyed by item (`c-<creativeId>`): they follow the swap.
    // Archived ones too, so a restore lands on the tile that is there.
    for (const r of replaced) {
      await tx
        .update(shareComments)
        .set({ itemKey: `c-${r.to}` })
        .where(
          and(eq(shareComments.shareGalleryId, shareId), eq(shareComments.itemKey, `c-${r.from}`)),
        );
    }

    const metadata: SnapshotMetadata = {
      generatedAt: new Date().toISOString(),
      messages: overlay(existing.messages, liveMessages),
      matrixItems: existing.matrixItems,
      creatives: creativeRows,
      assets: refreshedAssets,
      files: [...refreshedFiles, ...newFiles],
    };
    await tx
      .update(shareGalleries)
      .set({ metadata: JSON.stringify(metadata), updatedAt: nowUtc })
      .where(eq(shareGalleries.id, shareId));
    return {
      ok: true,
      changed,
      replaced,
      newFileIds: newFiles.map((f) => f.id),
      title: share.title,
    };
  });
}

/**
 * Cut the video strips now rather than leaving them to whoever opens the link.
 * They are a shared on-disk cache, so this is one pass for everybody — but
 * somebody has to be first, and it should not be the recipient sitting on
 * "preparing the video preview". storagePath is fetched here and NOT put in the
 * snapshot: that metadata is served to an unauthenticated viewer, and internal
 * storage keys have no business in it.
 *
 * The strips are not awaited: a share of many clips would hold the response
 * open for as long as ffmpeg takes, and the gap between saving a share and
 * someone opening it is far longer than the warm-up. Failures are logged inside
 * warmStills. The lookup is wrapped whole: the share is already written, and a
 * pre-fill of a cache must never be the reason the user does not get it back.
 */
export async function warmShareStills(
  clientId: number,
  shareId: string,
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return;
  try {
    const sources = await db
      .select({
        id: uploadedFiles.id,
        storagePath: uploadedFiles.storagePath,
        mimeType: uploadedFiles.mimeType,
      })
      .from(uploadedFiles)
      .where(
        and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, fileIds)),
      );
    const client = await getActiveClient();
    void warmStills(client.key, sources);
  } catch (e) {
    console.error(`[stills] warm skipped for share ${shareId}: ${(e as Error).message}`);
  }
}

/** One MC of a share on the Shares list, as the browser loads it. */
export type SharePreview = {
  /** `MC12a`; null for an item with no MC (a library asset). */
  label: string | null;
  size: string | null;
  /**
   * "file": a stored file — append `?thumb=<width>` for a sized still (the
   * poster of a video or an HTML5 package). "matrix": a generated preview PNG,
   * served whole. "none": the snapshot has no file for it.
   */
  kind: "matrix" | "file" | "none";
  /** null = nothing to show (no generated preview yet, or not a picture). */
  url: string | null;
};

/**
 * Every MC and variant of each share, one picture each, at the size
 * `sharePreviewGroups` chooses (share-list.ts) — the Shares list steps through
 * them. The URLs are the share's own public ones, the ones its viewer loads: a
 * file through /share/{id}/file, a matrix cell through a signed /publicshortcut
 * preview.
 */
export async function sharePreviews(
  clientId: number,
  shares: Array<{ id: string; metadata: string | null }>,
): Promise<Map<string, SharePreview[]>> {
  const groupsById = new Map<string, PreviewGroup[]>();
  const messageIds = new Set<number>();
  for (const share of shares) {
    const groups = share.metadata
      ? sharePreviewGroups(JSON.parse(share.metadata) as SnapshotLike)
      : [];
    for (const g of groups) if (g.ref.kind === "matrix") messageIds.add(g.ref.messageId);
    groupsById.set(share.id, groups);
  }

  // Chunked IN list, as in /share/[id]/previews: one row per template size.
  const previewVersion = new Map<string, string>();
  const ids = [...messageIds];
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const page = await db
      .select({
        messageId: messagePreviews.messageId,
        size: messagePreviews.size,
        updatedAt: messagePreviews.updatedAt,
      })
      .from(messagePreviews)
      .where(
        and(
          eq(messagePreviews.clientId, clientId),
          inArray(messagePreviews.messageId, ids.slice(i, i + CHUNK)),
        ),
      );
    for (const p of page) previewVersion.set(`${p.messageId}|${p.size}`, p.updatedAt);
  }

  const secret = ids.length ? await ensureSecret() : null;
  const result = new Map<string, SharePreview[]>();
  for (const [shareId, groups] of groupsById) {
    result.set(
      shareId,
      groups.map(({ label, size, ref }): SharePreview => {
        if (ref.kind === "matrix") {
          const v = previewVersion.get(`${ref.messageId}|${ref.size}`);
          if (!v || !secret) return { label, size, kind: "matrix", url: null };
          const token = signTokenWith(secret, "m", ref.messageId);
          return {
            label,
            size,
            kind: "matrix",
            url: `/publicshortcut/${token}/${encodeURIComponent(ref.size)}?v=${encodeURIComponent(v)}`,
          };
        }
        if (ref.kind === "file") {
          // An HTML5 package's ?thumb= is its poster, so it pictures too.
          const visual = creativeMediaKind(ref.mimeType) !== "other";
          return {
            label,
            size,
            kind: "file",
            url: visual ? `/share/${shareId}/file/${ref.fileId}` : null,
          };
        }
        return { label, size, kind: "none", url: null };
      }),
    );
  }
  return result;
}

const THUMBS_PER_SHARE = 4;

/**
 * The first few MCs of each share as 200px image URLs, so the add-to-share
 * picker can show which share is which. The same pictures the Shares list
 * shows — one per MC, not one per size — so a matrix share is not four copies
 * of its first card.
 */
export async function shareThumbs(
  clientId: number,
  shares: Array<{ id: string; metadata: string | null }>,
): Promise<Map<string, Array<string | null>>> {
  const previews = await sharePreviews(clientId, shares);
  const result = new Map<string, Array<string | null>>();
  for (const [shareId, list] of previews) {
    result.set(
      shareId,
      list
        .slice(0, THUMBS_PER_SHARE)
        .map((p) => (p.url !== null && p.kind === "file" ? `${p.url}?thumb=200` : p.url)),
    );
  }
  return result;
}

/**
 * The text on each share's creatives, for the Shares list filter
 * (`shareSearchText` in share-list.ts). An uploaded creative's `image_text` is
 * read from its current row, scoped to this client: the snapshot's copy is
 * usually older than the reading.
 */
export async function shareSearchTexts(
  clientId: number,
  shares: Array<{ id: string; metadata: string | null }>,
): Promise<Map<string, string>> {
  const metaById = new Map<string, SnapshotLike>();
  const creativeIds = new Set<number>();
  for (const share of shares) {
    const meta = share.metadata ? (JSON.parse(share.metadata) as SnapshotLike) : {};
    for (const c of meta.creatives ?? []) creativeIds.add(c.id);
    metaById.set(share.id, meta);
  }

  const currentText = new Map<number, string | null>();
  const ids = [...creativeIds];
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const page = await db
      .select({ id: creatives.id, imageText: creatives.imageText })
      .from(creatives)
      .where(
        and(eq(creatives.clientId, clientId), inArray(creatives.id, ids.slice(i, i + CHUNK))),
      );
    for (const c of page) currentText.set(c.id, c.imageText);
  }

  const result = new Map<string, string>();
  for (const [shareId, meta] of metaById) {
    result.set(shareId, shareSearchText(meta, currentText));
  }
  return result;
}
