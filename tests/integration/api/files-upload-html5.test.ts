import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, uploadedFiles, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { _setStorageRootForTests } from "@/lib/storage";
import { POST as uploadPOST } from "@/app/api/files/upload/route";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let storageRoot: string;

// readSession reads headers + cookies; the upload handler reads formData().
function uploadReq(token: string, file: File, category = "creative"): NextRequest {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("category", category);
  return {
    url: "http://localhost/api/files/upload",
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
    formData: async () => fd,
  } as unknown as NextRequest;
}

async function token() {
  const [u] = await db.select().from(users).limit(1);
  return signSession(u);
}

async function zipFile(name: string, files: Record<string, string>, type: string) {
  const zip = new JSZip();
  for (const [p, body] of Object.entries(files)) zip.file(p, body);
  return new File([await zip.generateAsync({ type: "arraybuffer" })], name, { type });
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-"));
  _setStorageRootForTests(storageRoot);
  withActiveClientKey("erste");
  const [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
});

afterEach(async () => {
  await h.cleanup();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("POST /api/files/upload — HTML5 packages", () => {
  it("stores a package as application/zip, sized from its manifest, whatever the browser called it", async () => {
    const file = await zipFile(
      "ERSTE_SZA_MC411_b_bird_html5_n1_640x360.zip",
      { "index.html": "<html></html>", "manifest.json": '{"width":640,"height":360}' },
      "application/x-zip-compressed",
    );
    const res = await uploadPOST(uploadReq(await token(), file), { params: Promise.resolve({}) });
    expect(res.status).toBe(201);
    const body = JSON.parse(await res.text());
    expect(body.file.mimeType).toBe("application/zip");
    expect(body.file.dimensions).toBe("640x360");
    expect(body.package).toEqual({ sizeSource: "manifest", warnings: [] });
  });

  it("refuses a zip with no index.html with a readable 400, and stores nothing", async () => {
    const file = await zipFile("broken_300x250.zip", { "a.html": "x" }, "application/zip");
    const res = await uploadPOST(uploadReq(await token(), file), { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
    expect(JSON.parse(await res.text())).toEqual({
      error: "invalid_html5_package",
      code: "no_index",
      message: "The package has no index.html.",
    });
    expect(await db.select().from(uploadedFiles)).toHaveLength(0);
  });

  it("leaves a zip uploaded outside the Creative Library alone", async () => {
    const file = await zipFile("anything.zip", { "a.txt": "x" }, "application/zip");
    const res = await uploadPOST(uploadReq(await token(), file, "share-file"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(201);
    expect(JSON.parse(await res.text()).package).toBeUndefined();
  });
});
