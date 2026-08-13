import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, draftMessages, draftPreviews } from "@/db/schema";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { GET as draftPreviewGET } from "@/app/api/draft-previews/[id]/route";

let h: TestDb;
let erste: { id: number };

function publicReq(id: number | string) {
  const url = `http://localhost/api/draft-previews/${id}`;
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

async function seedDraftPreview(clientId: number) {
  const [d] = await db
    .insert(draftMessages)
    .values({ clientId, template: "html", sizes: '["300x250"]' })
    .returning();
  const [p] = await db
    .insert(draftPreviews)
    .values({
      clientId,
      draftId: d!.id,
      size: "300x250",
      storageKey: "previews/does-not-exist.png",
    })
    .returning();
  return p!;
}

beforeEach(async () => {
  h = await createTestDb();
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("GET /api/draft-previews/[id] (public)", () => {
  it("serves without any auth: unknown id is 404, never 401", async () => {
    const [req, ctx] = publicReq(12345);
    const res = await draftPreviewGET(req, ctx);
    expect(res.status).toBe(404);
  });

  it("runs past auth to storage for an existing row (410 on missing bytes)", async () => {
    const p = await seedDraftPreview(erste.id);
    const [req, ctx] = publicReq(p.id);
    const res = await draftPreviewGET(req, ctx);
    expect(res.status).toBe(410);
  });

  it("stays scoped to the active client (other client's preview is 404)", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "Telekom" })
      .returning();
    const p = await seedDraftPreview(telekom.id);
    const [req, ctx] = publicReq(p.id);
    const res = await draftPreviewGET(req, ctx);
    expect(res.status).toBe(404);
  });
});
