import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  creatives,
  messages,
  messagePreviews,
  systemConfig,
  uploadedFiles,
} from "@/db/schema";
import {
  SECRET_KEY,
  signTokenWith,
} from "@/lib/public-shortcut";
import { GET as shortcutGET } from "@/app/publicshortcut/[...parts]/route";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

// 410 (storage_missing) is the "it got all the way through" signal here: the
// rows are seeded without bytes on purpose, so anything that reaches the object
// store has already passed the signature, the client scope and the row lookup.
// 404 is the single answer to every refusal — that is the contract.

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const SECRET = "test-secret";

beforeEach(async () => {
  h = await createTestDb();
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
  await db
    .insert(systemConfig)
    .values({ key: SECRET_KEY, value: SECRET });
});

afterEach(async () => {
  await h.cleanup();
});

function req(...parts: string[]) {
  const url = `http://localhost/publicshortcut/${parts.join("/")}`;
  return [
    {
      url,
      nextUrl: new URL(url),
      headers: new Headers(),
      cookies: { get: () => undefined },
    } as unknown as NextRequest,
    { params: Promise.resolve({ parts }) },
  ] as const;
}

async function seedMessage(
  clientId: number,
  number: number,
  status = "ACTIVE",
  audience: string | null = "aud1",
) {
  const [m] = await db
    .insert(messages)
    .values({
      clientId,
      number,
      variant: "a",
      audience,
      topic: "top1",
      template: "html",
      status,
    })
    .returning();
  await db.insert(messagePreviews).values({
    clientId,
    messageId: m!.id,
    size: "300x250",
    storageKey: `${clientId}/previews/none.png`,
    messageVersion: 1,
  });
  return m!;
}

async function seedCreative(clientId: number, archived = false) {
  const [f] = await db
    .insert(uploadedFiles)
    .values({
      id: `file-${clientId}-${archived ? "a" : "l"}`,
      clientId,
      filename: "x.png",
      originalFilename: "x.png",
      storagePath: `${clientId}/creatives/none.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      dimensions: "300x250",
      category: "creative",
    })
    .returning();
  const [c] = await db
    .insert(creatives)
    .values({
      clientId,
      fileId: f!.id,
      fileName: "x.png",
      fileDimensions: "300x250",
      ...(archived ? { archivedAt: "2026-09-01 00:00:00" } : {}),
    })
    .returning();
  return c!;
}

describe("GET /publicshortcut — DCO previews", () => {
  it("serves a signed message token at a declared size", async () => {
    const m = await seedMessage(erste.id, 1);
    const [r, ctx] = req(signTokenWith(SECRET, "m", m.id), "300x250");
    expect((await shortcutGET(r, ctx)).status).toBe(410);
  });

  it("serves a DRAFT — the signature replaces the status gate", async () => {
    // A draft is a message row with no audience; watching one take shape is
    // exactly what a client's agent is handed a link for.
    const m = await seedMessage(erste.id, 2, "DRAFT", null);
    const [r, ctx] = req(signTokenWith(SECRET, "m", m.id), "300x250");
    expect((await shortcutGET(r, ctx)).status).toBe(410);
  });

  it("serves INACTIVE and DEAD too", async () => {
    for (const [n, status] of [
      [3, "INACTIVE"],
      [4, "DEAD"],
    ] as const) {
      const m = await seedMessage(erste.id, n, status);
      const [r, ctx] = req(signTokenWith(SECRET, "m", m.id), "300x250");
      expect((await shortcutGET(r, ctx)).status).toBe(410);
    }
  });

  it("one signed token opens every generated size", async () => {
    const m = await seedMessage(erste.id, 5);
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: m.id,
      size: "970x250",
      storageKey: "erste/previews/none2.png",
      messageVersion: 1,
    });
    const token = signTokenWith(SECRET, "m", m.id);
    expect((await shortcutGET(...req(token, "300x250"))).status).toBe(410);
    expect((await shortcutGET(...req(token, "970x250"))).status).toBe(410);
  });

  it("404s a size that was never generated", async () => {
    const m = await seedMessage(erste.id, 6);
    const [r, ctx] = req(signTokenWith(SECRET, "m", m.id), "160x600");
    expect((await shortcutGET(r, ctx)).status).toBe(404);
  });

  it("404s a missing size segment", async () => {
    const m = await seedMessage(erste.id, 7);
    const [r, ctx] = req(signTokenWith(SECRET, "m", m.id));
    expect((await shortcutGET(r, ctx)).status).toBe(404);
  });

  it("404s another client's message even with a valid signature", async () => {
    const m = await seedMessage(telekom.id, 8);
    const [r, ctx] = req(signTokenWith(SECRET, "m", m.id), "300x250");
    expect((await shortcutGET(r, ctx)).status).toBe(404);
  });

  it("?html=1 returns a bare page sized to the preview", async () => {
    const m = await seedMessage(erste.id, 9);
    const token = signTokenWith(SECRET, "m", m.id);
    const url = `http://localhost/publicshortcut/${token}/300x250?html=1`;
    const res = await shortcutGET(
      {
        url,
        nextUrl: new URL(url),
        headers: new Headers(),
        cookies: { get: () => undefined },
      } as unknown as NextRequest,
      { params: Promise.resolve({ parts: [token, "300x250"] }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("width:300px;height:250px;");
    expect(body).toContain("margin:0");
    expect(body).toContain(`/publicshortcut/${token}/300x250`);
  });
});

describe("GET /publicshortcut — agentic creatives", () => {
  it("serves a signed creative token", async () => {
    const c = await seedCreative(erste.id);
    const [r, ctx] = req(signTokenWith(SECRET, "c", c.id));
    expect((await shortcutGET(r, ctx)).status).toBe(410);
  });

  it("404s an archived creative — gone is not private, but it is gone", async () => {
    const c = await seedCreative(erste.id, true);
    const [r, ctx] = req(signTokenWith(SECRET, "c", c.id));
    expect((await shortcutGET(r, ctx)).status).toBe(404);
  });

  it("404s another client's creative", async () => {
    const c = await seedCreative(telekom.id);
    const [r, ctx] = req(signTokenWith(SECRET, "c", c.id));
    expect((await shortcutGET(r, ctx)).status).toBe(404);
  });
});

describe("GET /publicshortcut — every refusal is the same 404", () => {
  it("a tampered signature", async () => {
    const m = await seedMessage(erste.id, 10);
    const bad = signTokenWith(SECRET, "m", m.id).replace(/.$/, "0");
    expect((await shortcutGET(...req(bad, "300x250"))).status).toBe(404);
  });

  it("a token signed with a different secret", async () => {
    const m = await seedMessage(erste.id, 11);
    const foreign = signTokenWith("someone-elses-secret", "m", m.id);
    expect((await shortcutGET(...req(foreign, "300x250"))).status).toBe(404);
  });

  it("the wrong kind for the id", async () => {
    const m = await seedMessage(erste.id, 12);
    const asCreative = signTokenWith(SECRET, "c", m.id);
    expect((await shortcutGET(...req(asCreative))).status).toBe(404);
  });

  it("no secret configured at all — fail closed, and do not mint one", async () => {
    const m = await seedMessage(erste.id, 13);
    const token = signTokenWith(SECRET, "m", m.id);
    await db.delete(systemConfig);
    expect((await shortcutGET(...req(token, "300x250"))).status).toBe(404);
    expect(await db.select().from(systemConfig)).toEqual([]);
  });

  it("garbage in the token slot", async () => {
    for (const bad of ["x", "m1", "m1.", "m1.zzzz"]) {
      expect((await shortcutGET(...req(bad, "300x250"))).status).toBe(404);
    }
  });
});
