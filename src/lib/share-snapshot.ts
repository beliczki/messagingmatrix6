// What a share gallery freezes into `metadata`, and how a selection from the
// creative library becomes (part of) one. Two callers: creating a share and
// adding to an existing one — they must resolve a selection identically, or a
// share built in two steps would differ from the same share built in one.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  creatives,
  messagePreviews,
  messages,
  nowUtc,
  shareGalleries,
  uploadedFiles,
} from "@/db/schema";
import { readTemplate } from "@/lib/templates";
import { getActiveClient } from "@/lib/active-client";
import { warmStills } from "@/lib/video-stills";
import { ensureSecret, signTokenWith } from "@/lib/public-shortcut";

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
  files?: SnapshotFile[];
};

export type ShareSelectionInput = {
  mcIds: number[];
  matrix: Array<{ messageId: number; size: string }>;
  creativeIds: number[];
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
  return { mcIds, matrix, creativeIds };
}

export function isEmptySelection(s: ShareSelectionInput): boolean {
  return s.mcIds.length === 0 && s.matrix.length === 0 && s.creativeIds.length === 0;
}

/** A selection resolved against this client's rows — the snapshot's parts. */
export type ResolvedSelection = Omit<SnapshotMetadata, "generatedAt"> & {
  matrixItems: Array<{ messageId: number; size: string }>;
  creatives: Array<typeof creatives.$inferSelect>;
  files: SnapshotFile[];
};

export async function resolveShareSelection(
  clientId: number,
  input: ShareSelectionInput,
): Promise<ResolvedSelection> {
  const { mcIds, matrix: matrixPairsIn, creativeIds } = input;

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

  // Snapshot file metadata for any creative that references one — the public
  // share viewer cannot hit the auth-gated /api/files endpoints, so we expose
  // these via a share-scoped proxy that checks the file id is in this list.
  const fileIds = Array.from(
    new Set(creativeRows.map((c) => c.fileId).filter((s): s is string => !!s)),
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

const THUMBS_PER_SHARE = 4;

/**
 * The first few items of each share as image URLs, in the order the viewer
 * shows them (matrix cells, then creatives) — so a picker can show which share
 * is which. They are the share's own public URLs, the ones its viewer loads:
 * a creative through /share/{id}/file (`?thumb=` is frame 0 on a video), a
 * matrix cell through a signed /publicshortcut preview. `null` = nothing to
 * show (no generated preview yet, or a file that is neither image nor video).
 */
export async function shareThumbs(
  clientId: number,
  shares: Array<{ id: string; metadata: string | null }>,
): Promise<Map<string, Array<string | null>>> {
  type Pick =
    | { kind: "matrix"; messageId: number; size: string }
    | { kind: "file"; fileId: string; mimeType: string | null }
    | { kind: "none" };
  const picks = new Map<string, Pick[]>();
  const messageIds = new Set<number>();
  for (const share of shares) {
    if (!share.metadata) {
      picks.set(share.id, []);
      continue;
    }
    const meta = JSON.parse(share.metadata) as Partial<SnapshotMetadata>;
    const filesById = new Map((meta.files ?? []).map((f) => [f.id, f]));
    const out: Pick[] = [];
    for (const p of meta.matrixItems ?? []) {
      if (out.length >= THUMBS_PER_SHARE) break;
      out.push({ kind: "matrix", messageId: p.messageId, size: p.size });
      messageIds.add(p.messageId);
    }
    for (const c of meta.creatives ?? []) {
      if (out.length >= THUMBS_PER_SHARE) break;
      const file = c.fileId ? filesById.get(c.fileId) : undefined;
      out.push(
        file
          ? { kind: "file", fileId: file.id, mimeType: file.mimeType }
          : { kind: "none" },
      );
    }
    picks.set(share.id, out);
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
  const result = new Map<string, Array<string | null>>();
  for (const [shareId, list] of picks) {
    result.set(
      shareId,
      list.map((p) => {
        if (p.kind === "matrix") {
          const v = previewVersion.get(`${p.messageId}|${p.size}`);
          if (!v || !secret) return null;
          const token = signTokenWith(secret, "m", p.messageId);
          return `/publicshortcut/${token}/${encodeURIComponent(p.size)}?v=${encodeURIComponent(v)}`;
        }
        if (p.kind === "file") {
          const visual =
            p.mimeType?.startsWith("image/") || p.mimeType?.startsWith("video/");
          return visual ? `/share/${shareId}/file/${p.fileId}?thumb=200` : null;
        }
        return null;
      }),
    );
  }
  return result;
}
