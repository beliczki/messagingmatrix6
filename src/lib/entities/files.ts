import { and, desc, eq, isNull, ilike } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { uploadedFiles, nowUtc, type UploadedFile } from "@/db/schema";
import {
  type StorageCategory,
  type StoredFile,
  deleteStorageFile,
  extFromFilename,
  extFromMime,
  writeFile,
} from "@/lib/storage";

export type UploadInput = {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  category: StorageCategory;
  uploadedBy: string;
  /** Optional WIDTHxHEIGHT — caller computes via sharp. */
  dimensions?: string;
};

// Spec §17.10 — sha256 dedup intra-client only.
export async function uploadFile(
  clientId: number,
  input: UploadInput,
): Promise<UploadedFile> {
  const sha = await sha256OfBuffer(input.buffer);

  // Look for an existing intra-client file with the same sha256.
  const [dup] = await db
    .select()
    .from(uploadedFiles)
    .where(
      and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.sha256, sha)),
    )
    .limit(1);
  if (dup) {
    // New logical row pointing at the same storage_path. Avoids re-writing
    // bytes; lets users rename without losing history.
    const [row] = await db
      .insert(uploadedFiles)
      .values({
        id: nanoid(),
        clientId,
        filename: sanitizeFilename(input.originalFilename),
        originalFilename: input.originalFilename,
        storagePath: dup.storagePath,
        mimeType: input.mimeType,
        sizeBytes: dup.sizeBytes,
        dimensions: dup.dimensions ?? input.dimensions ?? null,
        sha256: sha,
        uploadedBy: input.uploadedBy,
        category: input.category,
      })
      .returning();
    return row;
  }

  const ext =
    extFromFilename(input.originalFilename) || extFromMime(input.mimeType);
  const stored: StoredFile = await writeFile(input.buffer, input.category, ext);

  const [row] = await db
    .insert(uploadedFiles)
    .values({
      id: nanoid(),
      clientId,
      filename: sanitizeFilename(input.originalFilename),
      originalFilename: input.originalFilename,
      storagePath: stored.storagePath,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      dimensions: input.dimensions ?? null,
      sha256: sha,
      uploadedBy: input.uploadedBy,
      category: input.category,
    })
    .returning();
  return row;
}

export async function listFiles(
  clientId: number,
  opts: {
    category?: StorageCategory;
    q?: string;
    limit?: number;
    includeArchived?: boolean;
  } = {},
): Promise<UploadedFile[]> {
  const where = [eq(uploadedFiles.clientId, clientId)];
  if (opts.category) where.push(eq(uploadedFiles.category, opts.category));
  if (opts.q && opts.q.trim()) {
    // ilike, not like: Postgres LIKE is case-sensitive (SQLite's was not), so
    // a plain like() would silently miss "GEORGE" vs "george.jpg".
    where.push(ilike(uploadedFiles.filename, `%${opts.q.trim()}%`));
  }
  if (!opts.includeArchived) {
    where.push(isNull(uploadedFiles.archivedAt));
  }
  const q = db
    .select()
    .from(uploadedFiles)
    .where(and(...where))
    .orderBy(desc(uploadedFiles.createdAt));
  return opts.limit !== undefined ? q.limit(opts.limit) : q;
}

// Lookup by exact filename within a client. Used by /api/drive/proxy/* to
// resolve template-rendered references (messages.image1..6 / video1 store
// just a filename) back to the storage row. Returns the most recent match
// when multiple files share the name.
export async function getFileByFilename(
  clientId: number,
  filename: string,
): Promise<UploadedFile | null> {
  const rows = await db
    .select()
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, clientId),
        eq(uploadedFiles.filename, filename),
        isNull(uploadedFiles.archivedAt),
      ),
    )
    .orderBy(desc(uploadedFiles.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getFile(
  clientId: number,
  id: string,
): Promise<UploadedFile | null> {
  const rows = await db
    .select()
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

// Soft-archive: marks the row archived_at. Keeps the physical bytes — restore
// re-uses them, and other logical rows may still point at the same storage_path.
export async function archiveFile(
  clientId: number,
  id: string,
): Promise<{ ok: true; row: UploadedFile } | { ok: false }> {
  const row = await getFile(clientId, id);
  if (!row) return { ok: false };
  await db
    .update(uploadedFiles)
    .set({ archivedAt: nowUtc })
    .where(and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)));
  return { ok: true, row };
}

export async function restoreFile(
  clientId: number,
  id: string,
): Promise<{ ok: true; row: UploadedFile } | { ok: false }> {
  const row = await getFile(clientId, id);
  if (!row) return { ok: false };
  await db
    .update(uploadedFiles)
    .set({ archivedAt: null })
    .where(and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)));
  return { ok: true, row };
}

// Hard delete with ref-counting physical cleanup. Used only by snapshot
// restore wipe-then-insert and admin "purge archived" paths — never by the
// HTTP DELETE endpoint, which uses archiveFile.
export async function purgeFile(
  clientId: number,
  id: string,
): Promise<{ ok: true; row: UploadedFile } | { ok: false }> {
  const row = await getFile(clientId, id);
  if (!row) return { ok: false };

  // Don't unlink the bytes if another logical row points at the same path.
  const others = (
    await db
      .select({ id: uploadedFiles.id })
      .from(uploadedFiles)
      .where(
        and(
          eq(uploadedFiles.clientId, clientId),
          eq(uploadedFiles.storagePath, row.storagePath),
        ),
      )
  ).filter((r) => r.id !== id);
  if (others.length === 0) {
    await deleteStorageFile(row.storagePath);
  }
  await db
    .delete(uploadedFiles)
    .where(and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)));
  return { ok: true, row };
}

async function sha256OfBuffer(buf: Buffer): Promise<string> {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\w.\-+ ()]/g, "_").slice(0, 240);
}
