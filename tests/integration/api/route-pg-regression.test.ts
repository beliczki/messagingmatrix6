import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  auditLog,
  clients,
  messages,
  uploadedFiles,
  users,
} from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

// Route-LEVEL regression tests for the SQLite->Postgres dialect fallout fixed
// on 2026-06-28. The existing suite exercises lib functions directly, so it
// never went through the route handlers' JSON serialization or the actual SQL
// dialect — which is exactly why these bugs reached prod. Each test here calls
// the exported handler and would FAIL against the pre-fix code:
//   1. unawaited async -> NextResponse.json serializes a Promise as {} ->
//      `Array.isArray(body.x)` is false  (templates/files/history)
//   2. GROUP BY bare column -> Postgres 42803 -> the handler throws (users)
//   3. LIKE case-sensitivity -> Postgres LIKE misses "GEORGE" vs "george"
//      (files ?q=)
import { GET as templatesGET } from "@/app/api/templates/route";
import { GET as filesGET } from "@/app/api/files/route";
import { GET as historyGET } from "@/app/api/messages/[id]/history/route";
import { GET as usersGET } from "@/app/api/users/route";

let h: TestDb;
let erste: { id: number };

// readSession only touches headers + cookies; route handlers also read req.url.
function authedReq(token: string, url = "http://localhost/api"): NextRequest {
  return {
    url,
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

async function bodyOf(res: Response) {
  return JSON.parse(await res.text());
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
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
});

async function adminToken() {
  const [u] = await db.select().from(users).limit(1);
  return signSession(u);
}

describe("route handlers: SQLite->Postgres regression", () => {
  it("GET /api/templates returns an array (unawaited-Promise guard)", async () => {
    const res = await templatesGET(authedReq(await adminToken()), {});
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    // Pre-fix this was {} (a serialized pending Promise), so .find/.map crashed.
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it("GET /api/files returns an array AND search is case-insensitive (await + ilike guards)", async () => {
    await db.insert(uploadedFiles).values({
      id: "f1",
      clientId: erste.id,
      filename: "SZA_george_fitzone.jpg",
      originalFilename: "SZA_george_fitzone.jpg",
      storagePath: "erste/assets/2026/06/f1.jpg",
      category: "asset",
    });

    const token = await adminToken();
    const all = await bodyOf(await filesGET(authedReq(token), {}));
    expect(Array.isArray(all.files)).toBe(true);
    expect(all.files).toHaveLength(1);

    // Upper-case query must still match a lower-case filename — plain Postgres
    // LIKE (the pre-fix code) would return zero rows here.
    const url = "http://localhost/api/files?q=GEORGE";
    const hit = await bodyOf(await filesGET(authedReq(token, url), {}));
    expect(hit.files).toHaveLength(1);
    expect(hit.files[0].filename).toBe("SZA_george_fitzone.jpg");
  });

  it("GET /api/messages/[id]/history returns an array (unawaited-Promise guard)", async () => {
    const [mc] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "aud1",
        topic: "top1",
        versionNo: 1,
      })
      .returning();
    await db.insert(auditLog).values({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "messages",
      entityId: String(mc.id),
      action: "update",
      createdAt: "2026-06-01 10:00:00",
    });

    const res = await historyGET(authedReq(await adminToken()), {
      params: Promise.resolve({ id: String(mc.id) }),
    });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.history)).toBe(true);
    expect(body.history.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/users loads without 500 and reports each user's LATEST action (GROUP BY -> DISTINCT ON)", async () => {
    // Two audit rows for the same user; DISTINCT ON must surface the newer one.
    await db.insert(auditLog).values([
      {
        clientId: erste.id,
        userId: "u-admin",
        entityType: "messages",
        entityId: "1",
        action: "create",
        createdAt: "2026-06-01 09:00:00",
      },
      {
        clientId: erste.id,
        userId: "u-admin",
        entityType: "messages",
        entityId: "1",
        action: "archive",
        createdAt: "2026-06-02 09:00:00",
      },
    ]);

    // Pre-fix this threw Postgres 42803 ("Failed to load users").
    const res = await usersGET(authedReq(await adminToken()), {});
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Array.isArray(body.users)).toBe(true);
    const admin = body.users.find(
      (u: { email: string }) => u.email === "admin@erste.test",
    );
    expect(admin.lastAction).toBe("archive"); // the newer row, not "create"
  });
});
