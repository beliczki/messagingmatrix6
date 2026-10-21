import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, shareGalleries } from "@/db/schema";
import { uploadFile } from "@/lib/entities/files";
import { _setStorageRootForTests } from "@/lib/storage";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

const { GET } = await import("@/app/share/[id]/file/[fileId]/route");

let h: TestDb;
let storageRoot: string;
let erste: { id: number };

function req(url: string): NextRequest {
  return { url, headers: new Headers(), cookies: { get: () => undefined } } as unknown as NextRequest;
}

async function share(fileId: string) {
  await db.insert(shareGalleries).values({
    id: "s1",
    clientId: erste.id,
    metadata: JSON.stringify({ files: [{ id: fileId }] }),
  });
  return (query: string) =>
    GET(req(`http://localhost/share/s1/file/${fileId}${query}`), {
      params: Promise.resolve({ id: "s1", fileId }),
    });
}

beforeEach(async () => {
  h = await createTestDb();
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-"));
  _setStorageRootForTests(storageRoot);
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
});

afterEach(async () => {
  await h.cleanup();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("share file download in another format (?as=)", () => {
  it("converts a shared PNG and counts it as a download", async () => {
    const png = await sharp({ create: { width: 48, height: 40, channels: 3, background: "#0a5" } })
      .png()
      .toBuffer();
    const file = await uploadFile(erste.id, {
      buffer: png,
      originalFilename: "b_48x40.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u-test",
    });
    const get = await share(file.id);

    const webp = await get("?as=webp");
    expect(webp.status).toBe(200);
    expect(webp.headers.get("content-type")).toBe("image/webp");
    const meta = await sharp(Buffer.from(await webp.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 48, 40]);

    const jpg = await get("?as=jpg&q=40");
    expect(jpg.headers.get("content-type")).toBe("image/jpeg");

    const [row] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    expect(row!.downloadCount).toBe(2);

    const original = await get("");
    expect(original.headers.get("content-type")).toBe("image/png");
  });

  it("refuses an unknown format and a file that is not a raster picture", async () => {
    const video = await uploadFile(erste.id, {
      buffer: Buffer.from("not really a video"),
      originalFilename: "clip.mp4",
      mimeType: "video/mp4",
      category: "creative",
      uploadedBy: "u-test",
    });
    const get = await share(video.id);
    expect((await get("?as=jpg")).status).toBe(400);
    expect((await get("?as=gif")).status).toBe(400);
  });
});
