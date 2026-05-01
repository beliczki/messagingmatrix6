import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { uploadedFiles, type UploadedFile } from "@/db/schema";
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
  const dup = db
    .select()
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, clientId),
        eq(uploadedFiles.sha256, sha),
      ),
    )
    .get();
  if (dup) {
    // New logical row pointing at the same storage_path. Avoids re-writing
    // bytes; lets users rename without losing history.
    return db
      .insert(uploadedFiles)
      .values({
        id: nanoid(),
        clientId,
        filename: sanitize(input.originalFilename),
        originalFilename: input.originalFilename,
        storagePath: dup.storagePath,
        mimeType: input.mimeType,
        sizeBytes: dup.sizeBytes,
        dimensions: dup.dimensions ?? input.dimensions ?? null,
        sha256: sha,
        uploadedBy: input.uploadedBy,
        category: input.category,
      })
      .returning()
      .get();
  }

  const ext =
    extFromFilename(input.originalFilename) || extFromMime(input.mimeType);
  const stored: StoredFile = await writeFile(
    input.buffer,
    input.category,
    ext,
  );

  return db
    .insert(uploadedFiles)
    .values({
      id: nanoid(),
      clientId,
      filename: sanitize(input.originalFilename),
      originalFilename: input.originalFilename,
      storagePath: stored.storagePath,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      dimensions: input.dimensions ?? null,
      sha256: sha,
      uploadedBy: input.uploadedBy,
      category: input.category,
    })
    .returning()
    .get();
}

export function listFiles(
  clientId: number,
  opts: {
    category?: StorageCategory;
    q?: string;
    limit?: number;
    includeArchived?: boolean;
  } = {},
): UploadedFile[] {
  const where = [eq(uploadedFiles.clientId, clientId)];
  if (opts.category) where.push(eq(uploadedFiles.category, opts.category));
  if (opts.q && opts.q.trim()) {
    where.push(like(uploadedFiles.filename, `%${opts.q.trim()}%`));
  }
  if (!opts.includeArchived) {
    where.push(isNull(uploadedFiles.archivedAt));
  }
  const q = db
    .select()
    .from(uploadedFiles)
    .where(and(...where))
    .orderBy(desc(uploadedFiles.createdAt));
  return (opts.limit !== undefined ? q.limit(opts.limit) : q).all();
}

// Lookup by exact filename within a client. Used by /api/drive/proxy/* to
// resolve template-rendered references (messages.image1..6 / video1 store
// just a filename) back to the storage row. Returns the most recent match
// when multiple files share the name.
export function getFileByFilename(
  clientId: number,
  filename: string,
): UploadedFile | null {
  return (
    db
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
      .limit(1)
      .get() ?? null
  );
}

export function getFile(clientId: number, id: string): UploadedFile | null {
  return (
    db
      .select()
      .from(uploadedFiles)
      .where(
        and(
          eq(uploadedFiles.clientId, clientId),
          eq(uploadedFiles.id, id),
        ),
      )
      .get() ?? null
  );
}

// Soft-archive: marks the row archived_at. Keeps the physical bytes — restore
// re-uses them, and other logical rows may still point at the same storage_path.
export function archiveFile(
  clientId: number,
  id: string,
): { ok: true; row: UploadedFile } | { ok: false } {
  const row = getFile(clientId, id);
  if (!row) return { ok: false };
  db.update(uploadedFiles)
    .set({ archivedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)),
    )
    .run();
  return { ok: true, row };
}

export function restoreFile(
  clientId: number,
  id: string,
): { ok: true; row: UploadedFile } | { ok: false } {
  const row = getFile(clientId, id);
  if (!row) return { ok: false };
  db.update(uploadedFiles)
    .set({ archivedAt: null })
    .where(
      and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)),
    )
    .run();
  return { ok: true, row };
}

// Hard delete with ref-counting physical cleanup. Used only by snapshot
// restore wipe-then-insert and admin "purge archived" paths — never by the
// HTTP DELETE endpoint, which uses archiveFile.
export async function purgeFile(
  clientId: number,
  id: string,
): Promise<{ ok: true; row: UploadedFile } | { ok: false }> {
  const row = getFile(clientId, id);
  if (!row) return { ok: false };

  // Don't unlink the bytes if another logical row points at the same path.
  const others = db
    .select({ id: uploadedFiles.id })
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, clientId),
        eq(uploadedFiles.storagePath, row.storagePath),
      ),
    )
    .all()
    .filter((r) => r.id !== id);
  if (others.length === 0) {
    await deleteStorageFile(row.storagePath);
  }
  db.delete(uploadedFiles)
    .where(
      and(eq(uploadedFiles.clientId, clientId), eq(uploadedFiles.id, id)),
    )
    .run();
  return { ok: true, row };
}

async function sha256OfBuffer(buf: Buffer): Promise<string> {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sanitize(filename: string): string {
  return filename.replace(/[^\w.\-+ ()]/g, "_").slice(0, 240);
}
