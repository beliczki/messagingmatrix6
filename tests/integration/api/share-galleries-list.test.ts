import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  clients,
  creatives,
  messagePreviews,
  messages,
  shareGalleries,
  uploadedFiles,
  users,
} from "@/db/schema";
import { hashPassword, signSession } from "@/lib/auth";
import {
  resolveShareSelection,
  shareThumbs,
  type SnapshotMetadata,
} from "@/lib/share-snapshot";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

const { GET } = await import("@/app/api/share-galleries/route");

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };
let small: number; // MC12a 300x250
let square: number; // MC12a 1080x1080
let foreign: number; // a telekom creative

type ListRow = {
  id: string;
  previews: Array<{ label: string | null; size: string | null; kind: string; url: string | null }>;
  products: string[];
  searchText: string;
};

function req(token: string, query = ""): NextRequest {
  return {
    url: `http://localhost/api/share-galleries${query}`,
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
}

async function list(query = ""): Promise<ListRow[]> {
  const [u] = await db.select().from(users).limit(1);
  const res = await GET(req(await signSession(u), query), { params: Promise.resolve({}) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { shares: ListRow[] }).shares;
}

async function seedShare(id: string, selection: Parameters<typeof resolveShareSelection>[1]) {
  const resolved = await resolveShareSelection(erste.id, selection);
  const metadata: SnapshotMetadata = { generatedAt: "2026-11-01T00:00:00Z", ...resolved };
  await db.insert(shareGalleries).values({
    id,
    clientId: erste.id,
    title: "Diákszámla 2026Q4",
    metadata: JSON.stringify(metadata),
  });
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
  await db.insert(messages).values([
    { id: 1, clientId: erste.id, number: 400, variant: "a", audience: "aud1", topic: "HK_x", headline: "Hitel most" },
    // The same card copied into a second audience.
    { id: 2, clientId: erste.id, number: 400, variant: "a", audience: "aud2", topic: "HK_x", headline: "Hitel most" },
    { id: 3, clientId: erste.id, number: 401, variant: "b", audience: "aud1", topic: "HK_x", headline: "Lakáshitel" },
  ]);
  await db.insert(uploadedFiles).values([
    { id: "f-small", clientId: erste.id, filename: "s.png", originalFilename: "s.png", storagePath: "x/s.png", mimeType: "image/png", category: "creative" },
    { id: "f-square", clientId: erste.id, filename: "q.png", originalFilename: "q.png", storagePath: "x/q.png", mimeType: "image/png", category: "creative" },
  ]);
  [{ id: small }, { id: square }] = await db
    .insert(creatives)
    .values([
      { clientId: erste.id, mcNumber: 12, mcVariant: "a", fileId: "f-small", fileName: "s.png", fileDimensions: "300x250", product: "SZA" },
      { clientId: erste.id, mcNumber: 12, mcVariant: "a", fileId: "f-square", fileName: "q.png", fileDimensions: "1080x1080", product: "SZA" },
    ])
    .returning();
  [{ id: foreign }] = await db
    .insert(creatives)
    .values({ clientId: telekom.id, mcNumber: 9, mcVariant: "a", imageText: "Telekom szöveg" })
    .returning();
  await db.insert(messagePreviews).values({
    clientId: erste.id,
    messageId: 1,
    size: "1080x1080",
    storageKey: "k",
    messageVersion: 1,
  });
});

afterEach(async () => {
  await h.cleanup();
});

describe("GET /api/share-galleries — Shares list previews and filter data", () => {
  it("lists one picture per MC at the preferred size, the share's products and the text on its creatives", async () => {
    await seedShare("s1", {
      mcIds: [], assetIds: [],
      matrix: [
        { messageId: 1, size: "300x250" },
        { messageId: 1, size: "1080x1080" },
        { messageId: 2, size: "300x600" },
        { messageId: 3, size: "300x250" },
      ],
      creativeIds: [small, square],
    });
    // The picture was read AFTER the share was made: the snapshot has no text,
    // the creative row has. The list must find it.
    await db.update(creatives).set({ imageText: "Erste Diákszámla 0 Ft" }).where(eq(creatives.id, square));

    const [row] = await list();
    expect(row!.id).toBe("s1");
    expect(row!.previews).toHaveLength(3);
    expect(row!.previews[0]).toMatchObject({ label: "MC400a", size: "1080x1080", kind: "matrix" });
    expect(row!.previews[0]!.url).toMatch(/^\/publicshortcut\/.+\/1080x1080\?v=/);
    // MC401b has no generated preview: listed, nothing to show.
    expect(row!.previews[1]).toEqual({ label: "MC401b", size: "300x250", kind: "matrix", url: null });
    expect(row!.previews[2]).toEqual({ label: "MC12a", size: "1080x1080", kind: "file", url: "/share/s1/file/f-square" });
    expect(row!.products.sort()).toEqual(["HK", "SZA"]);
    // Each line once (MC400a's copy is in the snapshot twice); the message rows'
    // order in a snapshot is not fixed, so compare as a set.
    expect(row!.searchText.split("\n").sort()).toEqual(["Erste Diákszámla 0 Ft", "Hitel most", "Lakáshitel"]);
  });

  it("reads creative text only from the share's own client", async () => {
    // A snapshot naming another client's creative id must not pull its text.
    const metadata = {
      generatedAt: "2026-11-01T00:00:00Z",
      messages: [],
      creatives: [{ id: foreign, mcNumber: 9, mcVariant: "a", fileId: null, fileDimensions: null }],
    };
    await db.insert(shareGalleries).values({ id: "s2", clientId: erste.id, metadata: JSON.stringify(metadata) });
    const [row] = await list();
    expect(row!.searchText).toBe("");
    expect(row!.previews).toEqual([{ label: "MC9a", size: null, kind: "none", url: null }]);
  });

  it("gives no URL for a file the proxy cannot thumbnail, so the list never counts a download", async () => {
    await db.insert(uploadedFiles).values({
      id: "f-svg", clientId: erste.id, filename: "v.svg", originalFilename: "v.svg",
      storagePath: "x/v.svg", mimeType: "image/svg+xml", category: "creative",
    });
    const [{ id: svg }] = await db
      .insert(creatives)
      .values({ clientId: erste.id, mcNumber: 20, mcVariant: "a", fileId: "f-svg", fileName: "v.svg", fileDimensions: "1080x1080" })
      .returning();
    await seedShare("s1", { mcIds: [], assetIds: [], matrix: [], creativeIds: [svg] });
    const [row] = await list();
    expect(row!.previews).toEqual([{ label: "MC20a", size: "1080x1080", kind: "file", url: null }]);
  });

  it("lists an archived share's MCs without pictures: its public links no longer serve them", async () => {
    await seedShare("s1", {
      mcIds: [], assetIds: [],
      matrix: [{ messageId: 1, size: "1080x1080" }],
      creativeIds: [square],
    });
    await db.update(shareGalleries).set({ archivedAt: "2026-11-02 00:00:00" }).where(eq(shareGalleries.id, "s1"));
    const [row] = await list("?includeArchived=1");
    expect(row!.previews).toEqual([
      { label: "MC400a", size: "1080x1080", kind: "matrix", url: null },
      { label: "MC12a", size: "1080x1080", kind: "file", url: null },
    ]);
  });
});

describe("shareThumbs — the add-to-share picker", () => {
  it("shows each MC once, not the same MC in each of its sizes", async () => {
    await seedShare("s1", {
      mcIds: [], assetIds: [],
      matrix: [
        { messageId: 1, size: "300x250" },
        { messageId: 1, size: "970x250" },
        { messageId: 1, size: "1080x1080" },
      ],
      creativeIds: [small, square],
    });
    const [row] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    const thumbs = (await shareThumbs(erste.id, [row!])).get("s1")!;
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toMatch(/^\/publicshortcut\/.+\/1080x1080\?v=/);
    expect(thumbs[1]).toBe("/share/s1/file/f-square?thumb=200");
  });
});
