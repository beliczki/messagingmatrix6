import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  creatives,
  messagePreviews,
  messages,
  shareGalleries,
} from "@/db/schema";
import {
  addToShare,
  resolveShareSelection,
  shareThumbs,
  type SnapshotMetadata,
} from "@/lib/share-snapshot";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };
let creativeIds: number[];

async function seedShare(id: string, selection: Parameters<typeof resolveShareSelection>[1]) {
  const resolved = await resolveShareSelection(erste.id, selection);
  const metadata: SnapshotMetadata = { generatedAt: "2026-10-01T00:00:00Z", ...resolved };
  await db.insert(shareGalleries).values({
    id,
    clientId: erste.id,
    title: "Original",
    metadata: JSON.stringify(metadata),
  });
}

async function readSnapshot(id: string): Promise<SnapshotMetadata> {
  const [row] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, id));
  return JSON.parse(row.metadata!) as SnapshotMetadata;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  await db.insert(messages).values([
    { id: 1, clientId: erste.id, number: 400, variant: "a", audience: "aud", topic: "SZA_x" },
    { id: 2, clientId: erste.id, number: 401, variant: "a", audience: "aud", topic: "SZA_x" },
  ]);
  const rows = await db
    .insert(creatives)
    .values([
      { clientId: erste.id, fileName: "a.png" },
      { clientId: erste.id, fileName: "b.png" },
      { clientId: erste.id, fileName: "c.png" },
    ])
    .returning();
  creativeIds = rows.map((r) => r.id);
});

afterEach(async () => {
  await h.cleanup();
});

describe("addToShare", () => {
  it("appends new items at the end and skips what the share already holds", async () => {
    await seedShare("s1", {
      mcIds: [],
      matrix: [{ messageId: 1, size: "300x250" }],
      creativeIds: [creativeIds[0]],
    });
    const add = await resolveShareSelection(erste.id, {
      mcIds: [],
      matrix: [
        { messageId: 1, size: "300x250" }, // already in
        { messageId: 1, size: "970x250" },
        { messageId: 2, size: "300x250" },
      ],
      creativeIds: [creativeIds[2], creativeIds[0], creativeIds[1]],
    });
    const result = await addToShare(erste.id, "s1", add);
    expect(result).toMatchObject({ ok: true, added: 4, skipped: 2, title: "Original" });

    const snap = await readSnapshot("s1");
    expect(snap.matrixItems).toEqual([
      { messageId: 1, size: "300x250" },
      { messageId: 1, size: "970x250" },
      { messageId: 2, size: "300x250" },
    ]);
    // Existing first, then the new ones in the order they were sent.
    expect(snap.creatives!.map((c) => c.id)).toEqual([
      creativeIds[0],
      creativeIds[2],
      creativeIds[1],
    ]);
    // Message rows are a lookup table — each id once.
    expect(snap.messages.map((m) => m.id).sort()).toEqual([1, 2]);
    expect(snap.generatedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("writes nothing when every item is already in", async () => {
    await seedShare("s1", { mcIds: [], matrix: [], creativeIds: [creativeIds[0]] });
    const [before] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    const add = await resolveShareSelection(erste.id, {
      mcIds: [],
      matrix: [],
      creativeIds: [creativeIds[0]],
    });
    expect(await addToShare(erste.id, "s1", add)).toMatchObject({ ok: true, added: 0, skipped: 1 });
    const [after] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    expect(after.metadata).toBe(before.metadata);
  });

  it("refuses an archived share and another client's share", async () => {
    await seedShare("s1", { mcIds: [], matrix: [], creativeIds: [creativeIds[0]] });
    const add = await resolveShareSelection(erste.id, {
      mcIds: [],
      matrix: [],
      creativeIds: [creativeIds[1]],
    });
    expect(await addToShare(telekom.id, "s1", add)).toMatchObject({ ok: false, status: 404 });
    await db
      .update(shareGalleries)
      .set({ archivedAt: "2026-10-02 00:00:00" })
      .where(eq(shareGalleries.id, "s1"));
    expect(await addToShare(erste.id, "s1", add)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("shareThumbs", () => {
  it("gives the first items in viewer order, null where nothing can be shown", async () => {
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: 1,
      size: "300x250",
      storageKey: "k",
      messageVersion: 1,
    });
    await seedShare("s1", {
      mcIds: [],
      matrix: [
        { messageId: 1, size: "300x250" },
        { messageId: 2, size: "300x250" },
      ],
      creativeIds,
    });
    const [row] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    const thumbs = (await shareThumbs(erste.id, [row])).get("s1")!;
    expect(thumbs).toHaveLength(4);
    expect(thumbs[0]).toMatch(/^\/publicshortcut\/.+\/300x250\?v=/);
    // MC401 has no generated preview; the creatives carry no file.
    expect(thumbs.slice(1)).toEqual([null, null, null]);
  });
});
