import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLog, clients, creatives, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";

const drive = vi.hoisted(() => ({
  fail: false,
  files: [] as { id: string; name: string; mimeType: string }[],
}));

vi.mock("@/lib/drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/drive")>();
  return {
    ...actual,
    getDriveFolder: async (id: string) => {
      if (drive.fail) throw new actual.DriveError("GOOGLE_DRIVE_API_KEY is not set");
      return { id, name: "Leadas 04 13" };
    },
    listDriveFolder: async () => drive.files,
  };
});

const { POST } = await import("@/app/api/creatives/drive-resolve/route");

let h: TestDb;
let erste: { id: number };

function authedReq(token: string, body: unknown): NextRequest {
  return {
    url: "http://localhost/api/creatives/drive-resolve",
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }),
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

async function adminToken() {
  const [u] = await db.select().from(users).limit(1);
  return signSession(u);
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
  drive.fail = false;
  drive.files = [{ id: "FILE1", name: "banner_300x250.jpg", mimeType: "image/jpeg" }];
});

afterEach(async () => {
  await h.cleanup();
});

describe("POST /api/creatives/drive-resolve", () => {
  it("resolves the requested creatives and logs one audit row for the run", async () => {
    const [a] = await db
      .insert(creatives)
      .values({
        clientId: erste.id,
        fileName: "banner_300x250.jpg",
        driveFolderId: FOLDER,
      })
      .returning();
    const [b] = await db
      .insert(creatives)
      .values({ clientId: erste.id, fileName: "missing.jpg", driveFolderId: FOLDER })
      .returning();

    const res = await POST(authedReq(await adminToken(), { creativeIds: [a.id, b.id] }), {});
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.counts.resolved).toBe(1);
    expect(body.counts.file_not_found).toBe(1);

    const audits = await db.select().from(auditLog);
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0].after as string).kind).toBe("drive_resolve");
  });

  it("rejects an empty id list", async () => {
    const res = await POST(authedReq(await adminToken(), { creativeIds: [] }), {});
    expect(res.status).toBe(400);
  });

  it("rejects a batch bigger than the cap instead of silently truncating it", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const res = await POST(authedReq(await adminToken(), { creativeIds: ids }), {});
    expect(res.status).toBe(400);
    expect(JSON.parse(await res.text()).error).toBe("too_many_ids");
  });

  it("answers 502 when Drive itself is unavailable, and writes no audit row", async () => {
    drive.fail = true;
    const [a] = await db
      .insert(creatives)
      .values({
        clientId: erste.id,
        fileName: "banner_300x250.jpg",
        driveFolderId: FOLDER,
      })
      .returning();

    const res = await POST(authedReq(await adminToken(), { creativeIds: [a.id] }), {});
    expect(res.status).toBe(502);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});
