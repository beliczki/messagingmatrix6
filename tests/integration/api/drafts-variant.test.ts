import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { audiences, clients, topics, users } from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import { createDraft } from "@/lib/entities/messages";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

// `from_draft_id` on POST /api/drafts: another draft under the SAME MC number.
// It is an allocation directive read off the raw body, not a writable field —
// `number` and `variant` are deliberately absent from WRITABLE_FIELDS, and this
// route must not become the way back in.
const { POST } = await import("@/app/api/drafts/route");

let h: TestDb;
let erste: { id: number };

function authedReq(token: string, body: unknown): NextRequest {
  return {
    url: "http://localhost/api/drafts",
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
    key: "SZK_visitors",
    name: "Visitors",
    product: "SZK",
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

describe("POST /api/drafts", () => {
  it("still claims a fresh number when no source is sent", async () => {
    const first = await createDraft(erste.id);
    const { status, body } = await post({});
    expect(status).toBe(201);
    expect(body.draft.number).toBe(first.number + 1);
    expect(body.draft.variant).toBe("a");
  });

  it("creates the next variant of the named draft, duplicating by default", async () => {
    const a = await createDraft(erste.id, {
      headline: "EasyPay",
      draftProduct: "HK",
    });
    const { status, body } = await post({ from_draft_id: a.id });
    expect(status).toBe(201);
    expect(body.draft).toMatchObject({
      number: a.number,
      variant: "b",
      status: "DRAFT",
      audience: null,
      headline: "EasyPay",
      draftProduct: "HK",
    });
  });

  it("carries only the frame when mode is empty", async () => {
    const a = await createDraft(erste.id, {
      headline: "EasyPay",
      draftProduct: "HK",
      briefSlidesFileId: "deck-1",
    });
    const { body } = await post({ from_draft_id: a.id, mode: "empty" });
    expect(body.draft).toMatchObject({
      number: a.number,
      variant: "b",
      headline: null,
      draftProduct: "HK",
      briefSlidesFileId: "deck-1",
    });
  });

  it("ignores a number smuggled in as a field", async () => {
    const a = await createDraft(erste.id);
    const { body } = await post({ number: 9999, variant: "z" });
    expect(body.draft.number).toBe(a.number + 1);
    expect(body.draft.variant).toBe("a");
  });

  it("reports a source that is not a draft as a 400, not a crash", async () => {
    const { status, body } = await post({ from_draft_id: 123456 });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not found/);
  });
});
