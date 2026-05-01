import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  archiveFile,
  getFile,
  listFiles,
  purgeFile,
  restoreFile,
  uploadFile,
} from "@/lib/entities/files";
import { _setStorageRootForTests, readFileBytes } from "@/lib/storage";
import { withActiveClientKey, createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let storageRoot: string;
let erste: { id: number; key: string };
let telekom: { id: number; key: string };

// Smallest valid PNG (1×1 transparent) — keeps tests fast and storage tiny.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  h = createTestDb();
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-"));
  _setStorageRootForTests(storageRoot);

  erste = db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning()
    .get();
  telekom = db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning()
    .get();
});

afterEach(() => {
  h.cleanup();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("file upload + sha256 dedup", () => {
  it("first upload writes the bytes and stamps a row", async () => {
    withActiveClientKey("erste");
    const row = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "first.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u1",
    });
    expect(row.clientId).toBe(erste.id);
    expect(row.sha256).toBeTruthy();
    expect(row.storagePath).toMatch(/^erste\/assets\/\d{4}\/\d{2}\//);
    const bytes = await readFileBytes(row.storagePath);
    expect(bytes.equals(TINY_PNG)).toBe(true);
  });

  it("second upload of identical bytes (same client) reuses storage_path", async () => {
    withActiveClientKey("erste");
    const a = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "a.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u1",
    });
    const b = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "b.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u2",
    });
    expect(b.id).not.toBe(a.id);
    expect(b.sha256).toBe(a.sha256);
    expect(b.storagePath).toBe(a.storagePath); // dedup hit
  });

  it("identical bytes uploaded by Telekom does NOT reuse Erste's file (intra-client dedup only)", async () => {
    withActiveClientKey("erste");
    const e = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "shared.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u1",
    });

    withActiveClientKey("telekom");
    const t = await uploadFile(telekom.id, {
      buffer: TINY_PNG,
      originalFilename: "shared.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u2",
    });

    expect(t.sha256).toBe(e.sha256);
    expect(t.storagePath).not.toBe(e.storagePath);
    expect(t.storagePath).toMatch(/^telekom\//);
    expect(e.storagePath).toMatch(/^erste\//);
  });

  it("Erste cannot read a Telekom file by id", async () => {
    withActiveClientKey("telekom");
    const t = await uploadFile(telekom.id, {
      buffer: TINY_PNG,
      originalFilename: "secret.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u-telekom",
    });
    expect(getFile(erste.id, t.id)).toBeNull();
    expect(getFile(telekom.id, t.id)?.id).toBe(t.id);
  });

  it("listFiles is per-client", async () => {
    withActiveClientKey("erste");
    await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "e.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u1",
    });
    withActiveClientKey("telekom");
    await uploadFile(telekom.id, {
      buffer: TINY_PNG,
      originalFilename: "t.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u2",
    });
    expect(listFiles(erste.id)).toHaveLength(1);
    expect(listFiles(telekom.id)).toHaveLength(1);
    expect(listFiles(erste.id)[0].originalFilename).toBe("e.png");
  });

  it("deleting last logical row unlinks bytes; deleting one of N keeps bytes on disk", async () => {
    withActiveClientKey("erste");
    const a = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "a.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u",
    });
    const b = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "b.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u",
    });
    expect(b.storagePath).toBe(a.storagePath); // dedup hit

    // purge `a` — bytes should remain because `b` still references them.
    await purgeFile(erste.id, a.id);
    const stillThere = await readFileBytes(a.storagePath);
    expect(stillThere.length).toBe(TINY_PNG.length);

    // purge `b` — last reference, bytes should now be gone.
    await purgeFile(erste.id, b.id);
    await expect(readFileBytes(a.storagePath)).rejects.toThrow();
  });

  it("archive sets archived_at, keeps the bytes, hides from default list; restore brings it back", async () => {
    const f = await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "x.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "u",
    });
    const r = archiveFile(erste.id, f.id);
    expect(r.ok).toBe(true);
    expect(getFile(erste.id, f.id)?.archivedAt).not.toBeNull();
    // Bytes still on disk.
    expect((await readFileBytes(f.storagePath)).length).toBe(TINY_PNG.length);
    // Default list filter excludes it.
    expect(listFiles(erste.id).map((x) => x.id)).not.toContain(f.id);
    expect(
      listFiles(erste.id, { includeArchived: true }).map((x) => x.id),
    ).toContain(f.id);

    const back = restoreFile(erste.id, f.id);
    expect(back.ok).toBe(true);
    expect(getFile(erste.id, f.id)?.archivedAt).toBeNull();
  });
});
