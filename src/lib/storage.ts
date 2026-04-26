import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { getActiveClient } from "@/lib/active-client";

// Spec §17.10 — file storage layout includes a per-client prefix.
// Sha256 dedup is intra-client only (Spec §17.10).

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

export type StoredFile = {
  /** Relative path under storageRoot, e.g. erste/assets/2026/04/ab.jpg */
  storagePath: string;
  /** Absolute path on disk */
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
};

export async function writeFile(
  buffer: Buffer,
  category: StorageCategory,
  ext: string,
): Promise<StoredFile> {
  const client = getActiveClient();
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.join(client.key, categoryDir(category), yyyy, mm);
  const filename = `${sha.slice(0, 16)}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  const rel = path.join(dir, filename);
  const abs = path.join(storageRoot(), rel);

  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);

  return {
    storagePath: rel,
    absolutePath: abs,
    sha256: sha,
    sizeBytes: buffer.length,
  };
}

export function resolveStoragePath(rel: string): string {
  // Defense in depth — never permit absolute paths or `..` traversal.
  const norm = path.normalize(rel);
  if (norm.startsWith("..") || path.isAbsolute(norm)) {
    throw new Error(`Invalid storage path: ${rel}`);
  }
  return path.join(storageRoot(), norm);
}

export async function readFileBytes(rel: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(rel));
}

export async function deleteStorageFile(rel: string): Promise<void> {
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
