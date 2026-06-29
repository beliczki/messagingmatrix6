import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getActiveClient } from "@/lib/active-client";

// Spec §17.10 — file storage layout includes a per-client prefix.
// Sha256 dedup is intra-client only (Spec §17.10).
//
// Backend selection (one shared object store across local dev + live):
//   - If S3_BUCKET is set, source bytes live in an S3-compatible object store
//     (MinIO on the Hetzner box, reached via the same SSH tunnel as Postgres).
//     The relative storagePath IS the object key — no schema change.
//   - Otherwise they live on local disk under STORAGE_ROOT (tests + offline dev).
// Either way `storagePath` is the stable relative key stored in uploaded_files.
// Thumbnails are a derived, regenerable cache and ALWAYS stay on local disk
// (see resolveStoragePath) — they are never the source of truth.

export type StorageCategory = "asset" | "creative" | "template-file" | "share-file";

function storageRoot(): string {
  return process.env.STORAGE_ROOT
    ? path.resolve(process.cwd(), process.env.STORAGE_ROOT)
    : path.resolve(process.cwd(), "storage");
}

function categoryDir(cat: StorageCategory): string {
  // Plural directory names mirror v5 conventions.
  switch (cat) {
    case "asset":
      return "assets";
    case "creative":
      return "creatives";
    case "template-file":
      return "template-files";
    case "share-file":
      return "share-files";
  }
}

// --- Object-store driver -------------------------------------------------

function useS3(): boolean {
  return !!process.env.S3_BUCKET;
}

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    // S3_BUCKET is set (useS3 is true) but the rest of the config is missing —
    // fail loud rather than build a client that 403s with a cryptic message.
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "S3_BUCKET is set but S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not all configured",
      );
    }
    _s3 = new S3Client({
      endpoint,
      region: process.env.S3_REGION || "us-east-1",
      // MinIO and most self-hosted stores need path-style addressing.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _s3;
}

function bucket(): string {
  return process.env.S3_BUCKET as string;
}

// Normalize a relative storage path into a guarded form, rejecting traversal.
function safeRel(rel: string): string {
  const norm = path.normalize(rel);
  if (norm.startsWith("..") || path.isAbsolute(norm)) {
    throw new Error(`Invalid storage path: ${rel}`);
  }
  return norm;
}

// Object keys always use forward slashes regardless of host path separator.
function toKey(rel: string): string {
  return safeRel(rel).split(path.sep).join("/");
}

export type StoredFile = {
  /** Relative path under the store, e.g. erste/assets/2026/04/ab.jpg. Also the S3 key. */
  storagePath: string;
  /** Absolute path on disk — only set in local-fs mode. */
  absolutePath?: string;
  sha256: string;
  sizeBytes: number;
};

export async function writeFile(
  buffer: Buffer,
  category: StorageCategory,
  ext: string,
): Promise<StoredFile> {
  const client = await getActiveClient();
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.join(client.key, categoryDir(category), yyyy, mm);
  const filename = `${sha.slice(0, 16)}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const rel = path.join(dir, filename);

  if (useS3()) {
    await s3().send(
      new PutObjectCommand({ Bucket: bucket(), Key: toKey(rel), Body: buffer }),
    );
    return { storagePath: rel, sha256: sha, sizeBytes: buffer.length };
  }

  const abs = path.join(storageRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return { storagePath: rel, absolutePath: abs, sha256: sha, sizeBytes: buffer.length };
}

// Resolve a relative path to a LOCAL disk path under the storage root.
// In S3 mode this is no longer used for source bytes — it backs the local
// thumbnail cache (a regenerable derivative), which always stays on disk.
export function resolveStoragePath(rel: string): string {
  return path.join(storageRoot(), safeRel(rel));
}

export async function readFileBytes(rel: string): Promise<Buffer> {
  if (useS3()) {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: bucket(), Key: toKey(rel) }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return fs.readFile(resolveStoragePath(rel));
}

export async function deleteStorageFile(rel: string): Promise<void> {
  if (useS3()) {
    // S3 DeleteObject is idempotent — no error on a missing key.
    await s3().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: toKey(rel) }),
    );
    return;
  }
  try {
    await fs.unlink(resolveStoragePath(rel));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function extFromMime(mime: string, fallback = ""): string {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "." + m.slice(6).split(";")[0];
  if (m.startsWith("video/")) return "." + m.slice(6).split(";")[0];
  if (m === "application/pdf") return ".pdf";
  return fallback;
}

export function extFromFilename(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

// Set storage root (test-only).
export function _setStorageRootForTests(p: string) {
  process.env.STORAGE_ROOT = p;
}
