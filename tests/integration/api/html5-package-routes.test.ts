import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, shareGalleries, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { uploadFile } from "@/lib/entities/files";
import { _setStorageRootForTests } from "@/lib/storage";
import { GET as pkgGET } from "@/app/pkg/[token]/[...path]/route";
import { GET as sharePkgGET } from "@/app/share/[id]/pkg/[fileId]/[...path]/route";
import { GET as packageUrlGET } from "@/app/api/files/package-url/route";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let storageRoot: string;
let erste: { id: number };
let pkgId: string;
let pngId: string;

const anon = { url: "http://localhost/x" } as unknown as NextRequest;

function authedReq(token: string, url: string): NextRequest {
  return {
    url,
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

async function sessionToken() {
  const [u] = await db.select().from(users).limit(1);
  return signSession(u);
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

  const zip = new JSZip();
  zip.file("b/index.html", '<html><body><img src="img/bg.png"></body></html>');
  zip.file("b/img/bg.png", "png-bytes");
  pkgId = (
    await uploadFile(erste.id, {
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
      originalFilename: "ERSTE_SZA_MC411_b_bird_html5_n1_300x250.zip",
      mimeType: "application/zip",
      category: "creative",
      uploadedBy: "u-admin",
      dimensions: "300x250",
    })
  ).id;
  pngId = (
    await uploadFile(erste.id, {
      buffer: Buffer.from("not-a-zip"),
      originalFilename: "still.png",
      mimeType: "image/png",
      category: "creative",
      uploadedBy: "u-admin",
    })
  ).id;
});

afterEach(async () => {
  await h.cleanup();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

async function packageUrl(query: string) {
  const res = await packageUrlGET(
    authedReq(await sessionToken(), `http://localhost/api/files/package-url?${query}`),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, body: JSON.parse(await res.text()) };
}

function pkgReq(url: string) {
  // /pkg/<token>/<a>/<b> → params as Next hands them to the catch-all.
  const [, , token, ...rest] = url.split("/");
  return pkgGET(anon, {
    params: Promise.resolve({ token: decodeURIComponent(token!), path: rest }),
  });
}

describe("signed /pkg links", () => {
  it("hands out a link by file id or filename that plays the package and its assets", async () => {
    const byId = await packageUrl(`fileId=${pkgId}`);
    expect(byId.status).toBe(200);
    expect(byId.body.url).toMatch(/^\/pkg\/[^/]+\/index\.html$/);
    const byName = await packageUrl(
      "filename=ERSTE_SZA_MC411_b_bird_html5_n1_300x250.zip",
    );
    expect(byName.body.url).toBe(byId.body.url);

    const index = await pkgReq(byId.body.url);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(index.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    );
    const asset = await pkgReq(byId.body.url.replace("index.html", "img/bg.png"));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("png-bytes");
  });

  it("serves nothing for a tampered token, a path out of the package, or a non-package", async () => {
    const { body } = await packageUrl(`fileId=${pkgId}`);
    const tampered = body.url.replace(/\.([0-9a-f])/, (_: string, c: string) => `.${c === "0" ? "1" : "0"}`);
    expect((await pkgReq(tampered)).status).toBe(404);
    expect((await pkgReq(body.url.replace("index.html", "../../etc/passwd"))).status).toBe(404);
    expect((await packageUrl(`fileId=${pngId}`)).status).toBe(404);
  });
});

describe("share-scoped package entries", () => {
  async function shareWith(fileIds: string[], archived = false) {
    await db.insert(shareGalleries).values({
      id: "share1",
      clientId: erste.id,
      metadata: JSON.stringify({ files: fileIds.map((id) => ({ id })) }),
      archivedAt: archived ? "2026-10-12 00:00:00" : null,
    });
  }
  const get = (fileId: string, ...p: string[]) =>
    sharePkgGET(anon, { params: Promise.resolve({ id: "share1", fileId, path: p }) });

  it("plays a package listed in the share", async () => {
    await shareWith([pkgId]);
    const res = await get(pkgId, "img", "bg.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("stops when the package is not in the share, or the share is archived", async () => {
    await shareWith([pngId]);
    expect((await get(pkgId, "index.html")).status).toBe(404);
    await db
      .update(shareGalleries)
      .set({ metadata: JSON.stringify({ files: [{ id: pkgId }] }), archivedAt: "2026-10-12 00:00:00" })
      .where(eq(shareGalleries.id, "share1"));
    expect((await get(pkgId, "index.html")).status).toBe(404);
  });
});
