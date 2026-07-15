import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, messages, messagePreviews, users } from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import type { StalePreview } from "@/lib/previews";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

// The chromium shoot itself is not vitest-testable (needs a browser and a
// running server) — the route contract is tested with the shooter mocked.
vi.mock("@/lib/preview-shooter", () => ({
  shootPreviews: vi.fn(async (_clientId: number, items: StalePreview[]) =>
    items.map((it) => ({
      messageId: it.message.id,
      size: it.size,
      ok: true as const,
      previewId: it.existing?.id ?? 999,
    })),
  ),
}));

import { shootPreviews } from "@/lib/preview-shooter";
import { POST as generatePOST } from "@/app/api/previews/generate/route";
import { GET as statusGET } from "@/app/api/previews/status/route";
import { GET as previewGET } from "@/app/api/previews/[id]/route";

let h: TestDb;
let erste: { id: number };

function authedReq(
  token: string,
  url = "http://localhost/api",
  body?: unknown,
): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }),
    cookies: { get: () => undefined },
    json: async () => body,
  } as unknown as NextRequest;
}

async function bodyOf(res: Response) {
  return JSON.parse(await res.text());
}

async function seedUser(role: string, id: string) {
  await db.insert(users).values({
    id,
    clientId: erste.id,
    email: `${id}@erste.test`,
    password: await hashPassword("password123"),
    role,
  });
  const row = (await db.select().from(users)).find((r) => r.id === id)!;
  return signSession(row);
}

// Messages with template="html" (a real fs template with 4 sizes).
async function seedHtmlMessage(number: number) {
  const [m] = await db
    .insert(messages)
    .values({
      clientId: erste.id,
      number,
      variant: "a",
      audience: "aud1",
      topic: "top1",
      template: "html",
    })
    .returning();
  return m;
}

beforeEach(async () => {
  vi.mocked(shootPreviews).mockClear();
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("GET /api/previews/[id] (public)", () => {
  function publicReq(id: number | string) {
    const url = `http://localhost/api/previews/${id}`;
    return [
      {
        url,
        nextUrl: new URL(url),
        headers: new Headers(),
        cookies: { get: () => undefined },
      } as unknown as NextRequest,
      { params: Promise.resolve({ id: String(id) }) },
    ] as const;
  }

  it("serves without any auth: unknown id is 404, never 401", async () => {
    const [req, ctx] = publicReq(12345);
    const res = await previewGET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("runs past auth to storage for an existing row (410 on missing bytes)", async () => {
    const m = await seedHtmlMessage(1);
    const [p] = await db
      .insert(messagePreviews)
      .values({
        clientId: erste.id,
        messageId: m.id,
        size: "300x250",
        storageKey: "previews/does-not-exist.png",
        messageVersion: 1,
      })
      .returning();
    const [req, ctx] = publicReq(p.id);
    const res = await previewGET(req, ctx);
    expect(res.status).toBe(410);
  });

  it("stays scoped to the active client (other client's preview is 404)", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "Telekom" })
      .returning();
    const [m] = await db
      .insert(messages)
      .values({
        clientId: telekom.id,
        number: 1,
        variant: "a",
        audience: "aud1",
        topic: "top1",
        template: "html",
      })
      .returning();
    const [p] = await db
      .insert(messagePreviews)
      .values({
        clientId: telekom.id,
        messageId: m.id,
        size: "300x250",
        storageKey: "previews/telekom.png",
        messageVersion: 1,
      })
      .returning();
    // Active client is erste — telekom's preview must not be served here.
    const [req, ctx] = publicReq(p.id);
    const res = await previewGET(req, ctx);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/previews/generate", () => {
  it("401 without a session", async () => {
    const res = await generatePOST(
      {
        url: "http://localhost/api/previews/generate",
        headers: new Headers(),
        cookies: { get: () => undefined },
        json: async () => ({ message_ids: [1] }),
      } as unknown as NextRequest,
      {},
    );
    expect(res.status).toBe(401);
  });

  it("403 for demo users", async () => {
    const token = await seedUser("demo", "u-demo");
    const res = await generatePOST(
      authedReq(token, "http://localhost/api/previews/generate", {
        message_ids: [1],
      }),
      {},
    );
    expect(res.status).toBe(403);
  });

  it("400 on missing / empty / oversized / non-integer message_ids", async () => {
    const token = await seedUser("admin", "u-admin");
    for (const bad of [
      undefined,
      [],
      Array.from({ length: 21 }, (_, i) => i + 1),
      ["x"],
    ]) {
      const res = await generatePOST(
        authedReq(token, "http://localhost/api/previews/generate", {
          message_ids: bad,
        }),
        {},
      );
      expect(res.status).toBe(400);
    }
  });

  it("shoots exactly the stale pairs of the requested messages", async () => {
    const token = await seedUser("admin", "u-admin");
    const m1 = await seedHtmlMessage(1);
    const m2 = await seedHtmlMessage(2); // not requested

    const res = await generatePOST(
      authedReq(token, "http://localhost/api/previews/generate", {
        message_ids: [m1.id],
      }),
      {},
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    // html template has 4 sizes; every pair of m1 is missing → all shot.
    expect(body.results).toHaveLength(4);
    expect(body.results.every((r: { messageId: number }) => r.messageId === m1.id)).toBe(true);
    const passedItems = vi.mocked(shootPreviews).mock.calls[0]![1];
    expect(passedItems.every((it) => it.message.id === m1.id)).toBe(true);
    expect(passedItems.some((it) => it.message.id === m2.id)).toBe(false);
  });

  it("fresh sizes are skipped without force, included with force", async () => {
    const token = await seedUser("admin", "u-admin");
    const m1 = await seedHtmlMessage(1);
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: m1.id,
      size: "300x250",
      storageKey: "erste/previews/x.png",
      messageVersion: m1.version, // fresh
    });

    const plain = await generatePOST(
      authedReq(token, "http://localhost/api/previews/generate", {
        message_ids: [m1.id],
      }),
      {},
    );
    const plainBody = await bodyOf(plain);
    expect(plainBody.results).toHaveLength(3); // 4 sizes - 1 fresh
    expect(plainBody.freshSkipped).toBe(1);

    const forced = await generatePOST(
      authedReq(token, "http://localhost/api/previews/generate", {
        message_ids: [m1.id],
        force: true,
      }),
      {},
    );
    const forcedBody = await bodyOf(forced);
    expect(forcedBody.results).toHaveLength(4);
  });
});

describe("GET /api/previews/status?message_id=", () => {
  it("returns per-size detail with stale flags", async () => {
    const token = await seedUser("admin", "u-admin");
    const m1 = await seedHtmlMessage(1);
    const [fresh] = await db
      .insert(messagePreviews)
      .values({
        clientId: erste.id,
        messageId: m1.id,
        size: "300x250",
        storageKey: "erste/previews/a.png",
        messageVersion: m1.version,
      })
      .returning();

    const res = await statusGET(
      authedReq(
        token,
        `http://localhost/api/previews/status?message_id=${m1.id}`,
      ),
      {},
    );
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.messageId).toBe(m1.id);
    expect(body.version).toBe(m1.version);
    const s300 = body.sizes.find((s: { size: string }) => s.size === "300x250");
    expect(s300).toMatchObject({ previewId: fresh!.id, stale: false });
    expect(s300.updatedAt).toBeTruthy();
    const s970 = body.sizes.find((s: { size: string }) => s.size === "970x250");
    expect(s970).toMatchObject({ previewId: null, stale: true, updatedAt: null });
  });

  it("flips stale after the message version bumps", async () => {
    const token = await seedUser("admin", "u-admin");
    const m1 = await seedHtmlMessage(1);
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: m1.id,
      size: "300x250",
      storageKey: "erste/previews/a.png",
      messageVersion: m1.version,
    });
    const { eq } = await import("drizzle-orm");
    await db
      .update(messages)
      .set({ version: m1.version + 1 })
      .where(eq(messages.id, m1.id));

    const res = await statusGET(
      authedReq(
        token,
        `http://localhost/api/previews/status?message_id=${m1.id}`,
      ),
      {},
    );
    const body = await bodyOf(res);
    expect(
      body.sizes.find((s: { size: string }) => s.size === "300x250").stale,
    ).toBe(true);
  });

  it("404 for unknown id and for a non-html template", async () => {
    const token = await seedUser("admin", "u-admin");
    const unknown = await statusGET(
      authedReq(token, "http://localhost/api/previews/status?message_id=99999"),
      {},
    );
    expect(unknown.status).toBe(404);

    const [noTemplate] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 9,
        variant: "a",
        audience: "aud1",
        topic: "top1",
        template: null,
      })
      .returning();
    const res = await statusGET(
      authedReq(
        token,
        `http://localhost/api/previews/status?message_id=${noTemplate!.id}`,
      ),
      {},
    );
    expect(res.status).toBe(404);
  });
});
