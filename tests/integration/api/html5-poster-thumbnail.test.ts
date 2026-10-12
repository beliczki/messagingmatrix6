import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, shareGalleries, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { uploadFile } from "@/lib/entities/files";
import { _setStorageRootForTests } from "@/lib/storage";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

// The real shooter needs Chromium and a running app to load /pkg from; what is
// under test here is everything around it — routing a package to its poster,
// caching, the unavailable case.
const shootUrl = vi.fn();
vi.mock("@/lib/preview-shooter", () => ({
  shootUrl: (...a: unknown[]) => shootUrl(...a),
  defaultBaseUrl: () => "http://127.0.0.1:6001",
}));

const { GET: thumbGET } = await import("@/app/api/files/[id]/thumbnail/route");
const { GET: shareFileGET } = await import("@/app/share/[id]/file/[fileId]/route");

let h: TestDb;
let storageRoot: string;
let erste: { id: number };

function req(url: string, token?: string): NextRequest {
  return {
    url,
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {}),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

async function pkg(dimensions: string | undefined) {
  return uploadFile(erste.id, {
    buffer: Buffer.from(`zip-${dimensions}`),
    originalFilename: "b_300x250.zip",
    mimeType: "application/zip",
    category: "creative",
    uploadedBy: "u-admin",
    dimensions,
  });
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-"));
  _setStorageRootForTests(storageRoot);
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
  shootUrl.mockReset();
  shootUrl.mockResolvedValue(
    await sharp({ create: { width: 300, height: 250, channels: 3, background: "#0a5" } })
      .png()
      .toBuffer(),
  );
});

afterEach(async () => {
  await h.cleanup();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("HTML5 package thumbnails are posters", () => {
  it("shoots the signed package once at its native size, then serves the cached JPEG", async () => {
    const file = await pkg("300x250");
    const token = signSession((await db.select().from(users))[0]!);
    const url = `http://localhost/api/files/${file.id}/thumbnail?w=200`;
    const first = await thumbGET(req(url, await token), { params: Promise.resolve({ id: file.id }) });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect(shootUrl).toHaveBeenCalledTimes(1);
    const [shotUrl, w, h] = shootUrl.mock.calls[0]!;
    expect(shotUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:6001/pkg/${file.id}\\.[0-9a-f]{16}/index\\.html$`));
    expect([w, h]).toEqual([300, 250]);
    expect((await sharp(Buffer.from(await first.arrayBuffer())).metadata()).width).toBe(200);

    const again = await thumbGET(req(url, await token), { params: Promise.resolve({ id: file.id }) });
    expect(again.status).toBe(200);
    expect(shootUrl).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when the package has no size to frame — never a broken image", async () => {
    const file = await pkg(undefined);
    const token = await signSession((await db.select().from(users))[0]!);
    const res = await thumbGET(req(`http://localhost/api/files/${file.id}/thumbnail`, token), {
      params: Promise.resolve({ id: file.id }),
    });
    expect(res.status).toBe(503);
    expect(shootUrl).not.toHaveBeenCalled();
  });

  it("gives the share viewer the poster as ?thumb= and the zip itself as the download", async () => {
    const file = await pkg("300x250");
    await db.insert(shareGalleries).values({
      id: "s1",
      clientId: erste.id,
      metadata: JSON.stringify({ files: [{ id: file.id }] }),
    });
    const params = { params: Promise.resolve({ id: "s1", fileId: file.id }) };
    const thumb = await shareFileGET(req(`http://localhost/share/s1/file/${file.id}?thumb=400`), params);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    const download = await shareFileGET(req(`http://localhost/share/s1/file/${file.id}`), {
      params: Promise.resolve({ id: "s1", fileId: file.id }),
    });
    expect(download.headers.get("content-type")).toBe("application/zip");
  });
});
