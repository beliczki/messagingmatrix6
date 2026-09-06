import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, channels, clients, messages, topics, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { createDraft } from "@/lib/entities/messages";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

// The promote route's `target`: which world the work lands in. DCO and Agentic
// are one mechanism (promoteDraft resolves channel-audiences through the same
// lookup); "both" is promote + COPY, because a draft is ONE row and can become
// only one card — the second axis has to be a clone, not a second promote.
const { POST } = await import("@/app/api/drafts/[id]/promote/route");

let h: TestDb;
let erste: { id: number };

function authedReq(token: string, body: unknown): NextRequest {
  return {
    url: "http://localhost/api/drafts/1/promote",
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

async function promote(draftId: number, body: unknown) {
  const res = await POST(authedReq(await adminToken(), body), {
    params: Promise.resolve({ id: String(draftId) }),
  } as never);
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
  // Both axes exist in the fixture: a DCO audience (channel NULL) and a
  // channel, which is what an Agentic placement lands on.
  await db.insert(audiences).values({
    clientId: erste.id,
    key: "SZK_visitors",
    name: "Visitors",
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

describe("POST /api/drafts/[id]/promote — target", () => {
  it("defaults to the DCO cell when no target is sent (the pre-existing callers)", async () => {
    const d = await createDraft(erste.id, { headline: "No target" });
    const { status, body } = await promote(d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    expect(body.message).toMatchObject({
      id: d.id,
      audience: "SZK_visitors",
      topic: "SZK_brand",
      number: d.number,
    });
    expect(body.twins).toBeUndefined();
  });

  it("places the draft straight onto a channel for target 'agentic'", async () => {
    const d = await createDraft(erste.id, { headline: "Agency delivered" });
    const { status, body } = await promote(d.id, {
      target: "agentic",
      audienceKey: "ch_disp",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    // Same row, same number — a draft becomes the card it already was.
    expect(body.message).toMatchObject({
      id: d.id,
      audience: "ch_disp",
      number: d.number,
      headline: "Agency delivered",
    });
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.clientId, erste.id));
    expect(rows).toHaveLength(1);
  });

  it("reaches both axes under one number for target 'both'", async () => {
    const d = await createDraft(erste.id, { headline: "Both axes" });
    const { status, body } = await promote(d.id, {
      target: "both",
      audienceKey: "SZK_visitors",
      agenticAudienceKey: "ch_disp",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    expect(body.message).toMatchObject({
      id: d.id,
      audience: "SZK_visitors",
      number: d.number,
    });
    expect(body.twins).toHaveLength(1);
    // Cross-axis number reuse is deliberate: one card in two worlds. The twin
    // is a COPY, so it carries the content and gets its own identity.
    expect(body.twins[0]).toMatchObject({
      number: d.number,
      audience: "ch_disp",
      topic: "SZK_brand",
      headline: "Both axes",
    });
    expect(body.twins[0].pmmid).not.toBe(body.message.pmmid);
    expect(body.twins[0].id).not.toBe(d.id);
  });

  it("refuses 'both' without a channel rather than silently promoting one axis", async () => {
    const d = await createDraft(erste.id, {});
    const { status, body } = await promote(d.id, {
      target: "both",
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/agenticAudienceKey/);
    // The draft is untouched — a rejected promote must not half-place it.
    const [row] = await db.select().from(messages).where(eq(messages.id, d.id));
    expect(row).toMatchObject({ status: "DRAFT", audience: null });
  });

  // The draft's product is a DRAFT field. Once the row has a cell the product
  // is derived from it, so the stored value stops being read — it is not
  // cleared (the audit trail keeps what the draft said), it simply has no
  // further authority. This test pins that the promote does not start
  // reconciling the two.
  it("carries the draft product through untouched — the cell decides from here", async () => {
    const d = await createDraft(erste.id, { draftProduct: "SZK" });
    expect(d.draftProduct).toBe("SZK");
    const { status, body } = await promote(d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    // Placed: the product now comes from the audience, and the promote neither
    // validated the draft value against it nor wiped it.
    expect(body.message.audience).toBe("SZK_visitors");
    expect(body.message.draftProduct).toBe("SZK");
  });

  it("promotes a draft whose product was never set", async () => {
    const d = await createDraft(erste.id, {});
    expect(d.draftProduct).toBeNull();
    const { status, body } = await promote(d.id, {
      audienceKey: "SZK_visitors",
      topicKey: "SZK_brand",
    });
    expect(status).toBe(200);
    expect(body.message.draftProduct).toBeNull();
  });

  it("still refuses a topic that does not exist — promoting never mints one", async () => {
    const d = await createDraft(erste.id, {});
    const { status, body } = await promote(d.id, {
      target: "agentic",
      audienceKey: "ch_disp",
      topicKey: "SZK_nope",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/topic 'SZK_nope' not found/);
  });
});
