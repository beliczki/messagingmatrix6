import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, shareGalleries, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

const { GET } = await import("@/app/share/[id]/history/route");

let h: TestDb;
let erste: { id: number };

function req(shareId: string, itemKey: string): NextRequest {
  return {
    url: `http://localhost/share/${shareId}/history?itemKey=${encodeURIComponent(itemKey)}`,
  } as unknown as NextRequest;
}

function call(shareId: string, itemKey: string) {
  return GET(req(shareId, itemKey), { params: Promise.resolve({ id: shareId }) });
}

beforeEach(async () => {
  h = await createTestDb();
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@local",
    password: "x",
    role: "admin",
  });
  await db.insert(shareGalleries).values({
    id: "share1",
    clientId: erste.id,
    title: "Share",
    metadata: JSON.stringify({
      creatives: [{ id: 11 }],
      matrixItems: [{ messageId: 22, size: "300x250" }],
    }),
  });
});

afterEach(async () => {
  await h.cleanup();
});

describe("public share history route", () => {
  it("returns a creative's history, newest first, by display name", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "creatives",
      entityId: 11,
      action: "create",
      after: { id: 11, fileName: "a.png" },
    });
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "creatives",
      entityId: 11,
      action: "update",
      before: { id: 11, fileName: "a.png", driveFileId: null, updatedAt: "1" },
      after: { id: 11, fileName: "a.png", driveFileId: "d1", updatedAt: "2" },
    });

    const body = (await (await call("share1", "creative:11")).json()) as {
      entries: { action: string; by: string; fields: string[] }[];
    };
    expect(body.entries.map((e) => e.action)).toEqual(["update", "create"]);
    // The e-mail never leaves the server; the local part is the display name.
    expect(body.entries[0].by).toBe("admin");
    // Field names only, and bookkeeping columns are not "changes".
    expect(body.entries[0].fields).toEqual(["driveFileId"]);
  });

  it("resolves a matrix item to its card, whatever size is on screen", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: null,
      entityType: "messages",
      entityId: 22,
      action: "update",
      before: { headline: "a" },
      after: { headline: "b" },
    });
    const body = (await (await call("share1", "matrix:22:970x250")).json()) as {
      entries: { by: string; fields: string[] }[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].by).toBe("system");
    expect(body.entries[0].fields).toEqual(["headline"]);
  });

  it("refuses an entity the share does not contain", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "creatives",
      entityId: 99,
      action: "create",
      after: { id: 99, fileName: "secret.png" },
    });
    const res = await call("share1", "creative:99");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_in_share");
  });

  it("404s an archived share", async () => {
    await db
      .update(shareGalleries)
      .set({ archivedAt: "2026-01-01 00:00:00" });
    expect((await call("share1", "creative:11")).status).toBe(404);
  });
});
