import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, messages, shareGalleries, users } from "@/db/schema";
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
  // One card, two cells — plus the draft row it was promoted from. All three
  // are MC404b, and the card section is the union of their histories.
  await db.insert(messages).values([
    { id: 22, clientId: erste.id, number: 404, variant: "b", audience: "aud1", topic: "MARKET_x" },
    { id: 23, clientId: erste.id, number: 404, variant: "b", audience: "aud2", topic: "MARKET_x" },
  ]);
  await db.insert(shareGalleries).values({
    id: "share1",
    clientId: erste.id,
    title: "Share",
    metadata: JSON.stringify({
      creatives: [{ id: 11, mcNumber: 404, mcVariant: "b" }],
      matrixItems: [{ messageId: 22, size: "300x250" }],
      messages: [{ id: 22, number: 404, variant: "b" }],
    }),
  });
});

afterEach(async () => {
  await h.cleanup();
});

describe("public share history route", () => {
  it("returns a creative's own history, newest first, by display name", async () => {
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
      sections: { key: string; entries: { action: string; by: string; fields: string[] }[] }[];
    };
    const file = body.sections.find((s) => s.key === "creative")!;
    expect(file.entries.map((e) => e.action)).toEqual(["update", "create"]);
    // The e-mail never leaves the server; the local part is the display name.
    expect(file.entries[0].by).toBe("admin");
    // Field names only, and bookkeeping columns are not "changes".
    expect(file.entries[0].fields).toEqual(["driveFileId"]);
  });

  it("puts the card's history in its own section, merged across the card's rows", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "creatives",
      entityId: 11,
      action: "create",
      after: { id: 11 },
    });
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "messages",
      entityId: 22,
      action: "update",
      before: { headline: "a" },
      after: { headline: "b" },
    });
    // A second cell of the SAME card: one card, so one section.
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "messages",
      entityId: 23,
      action: "update",
      before: { cta: "x" },
      after: { cta: "y" },
    });

    const body = (await (await call("share1", "creative:11")).json()) as {
      sections: { key: string; label: string; entries: { fields: string[] }[] }[];
    };
    expect(body.sections.map((s) => s.key)).toEqual(["creative", "card"]);
    const card = body.sections[1];
    expect(card.label).toBe("Card · MC404b");
    expect(card.entries).toHaveLength(2);
    expect(card.entries.flatMap((e) => e.fields).sort()).toEqual(["cta", "headline"]);
  });

  it("resolves a matrix item to its card and to the share's files for it", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: null,
      entityType: "messages",
      entityId: 22,
      action: "update",
      before: { headline: "a" },
      after: { headline: "b" },
    });
    await writeAudit({
      clientId: erste.id,
      userId: "u-admin",
      entityType: "creatives",
      entityId: 11,
      action: "create",
      after: { id: 11 },
    });

    const body = (await (await call("share1", "matrix:22:970x250")).json()) as {
      sections: { key: string; entries: { by: string; fields: string[] }[] }[];
    };
    expect(body.sections.map((s) => s.key)).toEqual(["card", "creatives"]);
    expect(body.sections[0].entries[0].by).toBe("system");
    expect(body.sections[0].entries[0].fields).toEqual(["headline"]);
    expect(body.sections[1].entries).toHaveLength(1);
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
