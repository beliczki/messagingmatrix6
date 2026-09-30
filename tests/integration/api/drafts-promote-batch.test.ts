import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, channels, clients, messages, topics, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { createDraft, createDraftVariant } from "@/lib/entities/messages";
import { createCreativeWithMirror } from "@/lib/entities/promote";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

// One decision, one call: which variants of an MC go, where, and what happens
// to the ones that stay. Promotion CONVERTS — the rows that go stop being
// drafts — so `archiveRest` is about the leftovers, never about the promoted.
const { POST } = await import("@/app/api/drafts/promote/route");

let h: TestDb;
let erste: { id: number };

function authedReq(token: string, body: unknown): NextRequest {
  return {
    url: "http://localhost/api/drafts/promote",
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }),
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

async function post(body: unknown) {
  const [u] = await db.select().from(users).limit(1);
  const res = await POST(authedReq(await signSession(u), body), {} as never);
  return { status: res.status, body: JSON.parse(await res.text()) };
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
  await db.insert(audiences).values({
    clientId: erste.id,
    key: "SZK_INCOMING",
    name: "Incoming",
    product: "SZK",
    orderIndex: 1,
  });
  await db.insert(channels).values({
    clientId: erste.id,
    key: "ch_disp",
    code: "DISP",
    label: "Display",
    orderIndex: 1,
  });
  await db.insert(topics).values({
    clientId: erste.id,
    key: "SZK_brand",
    name: "Brand",
    product: "SZK",
    orderIndex: 1,
  });
});

afterEach(async () => {
  await h.cleanup();
});

async function mcWithVariants(n: number) {
  const a = await createDraft(erste.id, { name: "a" });
  const rest = [];
  for (let i = 1; i < n; i += 1) {
    rest.push(await createDraftVariant(erste.id, a.id, "empty"));
  }
  return [a, ...rest];
}

describe("POST /api/drafts/promote", () => {
  it("promotes every selected variant into one cell, letters intact", async () => {
    const [a, b, c] = await mcWithVariants(3);
    const { status, body } = await post({
      ids: [a!.id, b!.id, c!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });

    expect(status).toBe(200);
    expect(body.promoted.map((p: { variant: string }) => p.variant)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(body.promoted.every((p: { status: string }) => p.status === "PREVIEW")).toBe(
      true,
    );
    expect(body.promoted.every((p: { pmmid: string }) => !!p.pmmid)).toBe(true);
  });

  it("keeps a promoted variant's own letter when the cell has room for it", async () => {
    const [a, b, c] = await mcWithVariants(3);
    // a and c only: without the own-letter rule, c would land as b.
    const { body } = await post({
      ids: [a!.id, c!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(body.promoted.map((p: { variant: string }) => p.variant)).toEqual([
      "a",
      "c",
    ]);
    // b stayed a draft.
    const [stillDraft] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, b!.id));
    expect(stillDraft!.status).toBe("DRAFT");
  });

  it("leaves the unpromoted variants alone by default", async () => {
    const [a, b] = await mcWithVariants(2);
    const { body } = await post({
      ids: [a!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(body.archived).toBe(0);
    const [left] = await db.select().from(messages).where(eq(messages.id, b!.id));
    expect(left!.archivedAt).toBeNull();
  });

  it("archives the leftovers when asked, and only those", async () => {
    const [a, b, c] = await mcWithVariants(3);
    const { body } = await post({
      ids: [a!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
      archiveRest: true,
    });
    expect(body.archived).toBe(2);

    const rows = await db.select().from(messages);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a!.id)!.archivedAt).toBeNull();
    expect(byId.get(a!.id)!.status).toBe("PREVIEW");
    expect(byId.get(b!.id)!.archivedAt).not.toBeNull();
    expect(byId.get(c!.id)!.archivedAt).not.toBeNull();
  });

  it("honours an explicit status", async () => {
    const [a] = await mcWithVariants(1);
    const { body } = await post({
      ids: [a!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
      status: "APPROVED",
    });
    expect(body.promoted[0].status).toBe("APPROVED");
  });

  it("places onto a channel — the Agentic axis is the same mechanism", async () => {
    const [a] = await mcWithVariants(1);
    const { status, body } = await post({
      ids: [a!.id],
      audienceKey: "ch_disp",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    expect(body.promoted[0].audience).toBe("ch_disp");
  });

  it("refuses ids from two different MC numbers", async () => {
    const [a] = await mcWithVariants(1);
    const other = await createDraft(erste.id);
    const { status, body } = await post({
      ids: [a!.id, other.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/one MC number/);
  });

  it("refuses a row that is already in the matrix", async () => {
    const [a] = await mcWithVariants(1);
    await post({
      ids: [a!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    const { status, body } = await post({
      ids: [a!.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already in the matrix/);
  });

  // A Both card (user, 2026-09-30): its DCO row needs a topics row the brief
  // planned but nobody created, and its delivered files used to land in a
  // topic derived from their filenames instead of that one.
  it("creates the brief's topic and lands the Agentic cells in it too", async () => {
    const a = await createDraft(erste.id, {
      name: "a",
      draftProduct: "SZK",
      draftTarget: "both",
      topic: "SZK_edukacio_kamat_NA_thmcsokkentes",
    });
    await createCreativeWithMirror(erste.id, {
      fileName: `ERSTE_SZK_MC${a.number}_a_kamatcsokkentes_n1_300x250.png`,
      product: "SZK",
      mcNumber: a.number,
      mcVariant: "a",
    });

    const { status, body } = await post({
      ids: [a.id],
      audienceKey: "SZK_INCOMING",
      newTopic: { name: "Kamatcsökkentés" },
    });
    expect(status).toBe(200);

    const [created] = await db
      .select()
      .from(topics)
      .where(eq(topics.name, "Kamatcsökkentés"));
    expect([created!.product, created!.tag1, created!.tag2, created!.tag3, created!.tag4])
      .toEqual(["SZK", "edukacio", "kamat", "NA", "thmcsokkentes"]);
    expect(body.promoted[0].topic).toBe(created!.key);

    const cells = await db
      .select()
      .from(messages)
      .where(eq(messages.number, a.number));
    const agentic = cells.filter((c) => c.audience === "ch_disp");
    expect(agentic).toHaveLength(1);
    expect(agentic[0]!.topic).toBe(created!.key);
  });

  // MC410, 2026-09-30: a Both card promoted onto a DCO row. The sibling pass
  // after `a` saw `b` and `c` still drafted and `a` not placed on a CHANNEL, so
  // it re-drafted `a` as a letter the brief never named — then `b`, then `c`.
  // Three Untitled drafts, and no Agentic cell at all.
  it("a Both card promoted onto DCO leaves no draft and places its files", async () => {
    const a = await createDraft(erste.id, {
      name: "a",
      draftProduct: "SZK",
      draftTarget: "both",
      topic: "SZK_brand",
    });
    const b = await createDraftVariant(erste.id, a.id, "duplicate");
    for (const v of ["a", "b"]) {
      await createCreativeWithMirror(erste.id, {
        fileName: `ERSTE_SZK_MC${a.number}_${v}_kamat_n1_300x250.png`,
        product: "SZK",
        mcNumber: a.number,
        mcVariant: v,
      });
    }

    const { status } = await post({
      ids: [a.id, b.id],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);

    const cells = await db
      .select()
      .from(messages)
      .where(eq(messages.number, a.number));
    expect(cells.filter((c) => c.status === "DRAFT")).toHaveLength(0);
    const agentic = cells.filter((c) => c.audience === "ch_disp");
    expect(agentic.map((c) => [c.variant, c.topic])).toEqual([
      ["a", "SZK_brand"],
      ["b", "SZK_brand"],
    ]);
  });

  it("refuses to create a topic whose tags already exist", async () => {
    await db.insert(topics).values({
      clientId: erste.id,
      key: "SZK_edukacio_kamat_NA_x",
      name: "Existing",
      product: "SZK",
      tag1: "edukacio",
      tag2: "kamat",
      tag3: "NA",
      tag4: "x",
      orderIndex: 2,
    });
    const a = await createDraft(erste.id, {
      name: "a",
      draftProduct: "SZK",
      topic: "SZK_edukacio_kamat_NA_x",
    });
    const { status, body } = await post({
      ids: [a.id],
      audienceKey: "SZK_INCOMING",
      newTopic: { name: "Dup" },
    });
    expect(status).toBe(409);
    expect(body.error).toMatch(/SZK_edukacio_kamat_NA_x/);
  });

  it("refuses an empty selection", async () => {
    const { status } = await post({
      ids: [],
      audienceKey: "SZK_INCOMING",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(400);
  });
});
