import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  clients,
  creatives,
  messagePreviews,
  messages,
  shareComments,
  shareGalleries,
} from "@/db/schema";
import {
  addToShare,
  refreshShare,
  resolveShareSelection,
  shareThumbs,
  type SnapshotMetadata,
} from "@/lib/share-snapshot";
import { loadSharedFile } from "@/lib/share-file";
import { shareItemCount } from "@/lib/share-metadata";
import { uploadedFiles } from "@/db/schema";
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
      mcIds: [], assetIds: [],
      matrix: [{ messageId: 1, size: "300x250" }],
      creativeIds: [creativeIds[0]],
    });
    const add = await resolveShareSelection(erste.id, {
      mcIds: [], assetIds: [],
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
    await seedShare("s1", { mcIds: [], assetIds: [], matrix: [], creativeIds: [creativeIds[0]] });
    const [before] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    const add = await resolveShareSelection(erste.id, {
      mcIds: [], assetIds: [],
      matrix: [],
      creativeIds: [creativeIds[0]],
    });
    expect(await addToShare(erste.id, "s1", add)).toMatchObject({ ok: true, added: 0, skipped: 1 });
    const [after] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "s1"));
    expect(after.metadata).toBe(before.metadata);
  });

  it("refuses an archived share and another client's share", async () => {
    await seedShare("s1", { mcIds: [], assetIds: [], matrix: [], creativeIds: [creativeIds[0]] });
    const add = await resolveShareSelection(erste.id, {
      mcIds: [], assetIds: [],
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

describe("refreshShare", () => {
  it("swaps frozen rows for the live ones and keeps items, order and deleted rows", async () => {
    await seedShare("s1", {
      mcIds: [], assetIds: [],
      matrix: [
        { messageId: 2, size: "300x250" },
        { messageId: 1, size: "970x250" },
      ],
      creativeIds: [creativeIds[1], creativeIds[0]],
    });
    const before = await readSnapshot("s1");
    await db
      .update(messages)
      .set({ customCss: ".x{color:red}", headlineStyle: "font-size:2rem;" })
      .where(eq(messages.id, 1));
    await db.update(creatives).set({ comment: "new" }).where(eq(creatives.id, creativeIds[0]));
    await db.delete(messages).where(eq(messages.id, 2));

    expect(await refreshShare(erste.id, "s1")).toMatchObject({ ok: true, changed: 2 });

    const snap = await readSnapshot("s1");
    expect(snap.matrixItems).toEqual(before.matrixItems);
    expect(snap.creatives!.map((c) => c.id)).toEqual([creativeIds[1], creativeIds[0]]);
    const m1 = snap.messages.find((m) => m.id === 1)!;
    expect(m1.customCss).toBe(".x{color:red}");
    expect(m1.headlineStyle).toBe("font-size:2rem;");
    // Deleted live — the frozen copy stays so the link has no hole.
    expect(snap.messages.find((m) => m.id === 2)).toEqual(
      before.messages.find((m) => m.id === 2),
    );
    expect(snap.creatives!.find((c) => c.id === creativeIds[0])!.comment).toBe("new");
    expect(snap.generatedAt).not.toBe(before.generatedAt);
  });

  it("refuses an archived share and another client's share", async () => {
    await seedShare("s1", { mcIds: [], assetIds: [], matrix: [], creativeIds: [creativeIds[0]] });
    expect(await refreshShare(telekom.id, "s1")).toMatchObject({ ok: false, status: 404 });
    await db
      .update(shareGalleries)
      .set({ archivedAt: "2026-10-02 00:00:00" })
      .where(eq(shareGalleries.id, "s1"));
    expect(await refreshShare(erste.id, "s1")).toMatchObject({ ok: false, status: 409 });
  });
});

describe("refreshShare — newer versions", () => {
  // MC420 as delivered: a picture and an HTML5 zip of the same name are two
  // families; a 300x250 n2 that was archived must not count.
  async function seedVersions() {
    const file = (id: string, filename: string, mimeType: string) => ({
      id, clientId: erste.id, filename, originalFilename: filename,
      storagePath: `x/${filename}`, mimeType, category: "creative",
    });
    await db.insert(uploadedFiles).values([
      file("f-a1", "ERSTE_SZA_MC420_a_BF_n1_1080x1920.jpg", "image/jpeg"),
      file("f-a2", "ERSTE_SZA_MC420_a_BF_n2_1080x1920.jpg", "image/jpeg"),
      file("f-p1", "ERSTE_SZA_MC420_a_BF_n1_300x250.jpg", "image/jpeg"),
      file("f-p2", "ERSTE_SZA_MC420_a_BF_n2_300x250.jpg", "image/jpeg"),
      file("f-z1", "ERSTE_SZA_MC420_a_BF_n1_300x250.zip", "application/zip"),
      file("f-z2", "ERSTE_SZA_MC420_a_BF_n2_300x250.zip", "application/zip"),
    ]);
    const row = (fileId: string, fileName: string, archivedAt: string | null = null) => ({
      clientId: erste.id, fileId, fileName, mcNumber: 420, mcVariant: "a", archivedAt,
    });
    const [a1, a2, p1, , z1, z2] = await db
      .insert(creatives)
      .values([
        row("f-a1", "ERSTE_SZA_MC420_a_BF_n1_1080x1920.jpg"),
        row("f-a2", "ERSTE_SZA_MC420_a_BF_n2_1080x1920.jpg"),
        row("f-p1", "ERSTE_SZA_MC420_a_BF_n1_300x250.jpg"),
        row("f-p2", "ERSTE_SZA_MC420_a_BF_n2_300x250.jpg", "2026-11-20 09:00:00"),
        row("f-z1", "ERSTE_SZA_MC420_a_BF_n1_300x250.zip"),
        row("f-z2", "ERSTE_SZA_MC420_a_BF_n2_300x250.zip"),
      ])
      .returning();
    // Another client's n3 of the same name is not this share's newer version.
    await db.insert(creatives).values({
      clientId: telekom.id, fileName: "ERSTE_SZA_MC420_a_BF_n3_1080x1920.jpg", mcNumber: 420,
    });
    return { a1: a1!.id, a2: a2!.id, p1: p1!.id, z1: z1!.id, z2: z2!.id };
  }

  async function commentKeys(shareId: string) {
    const rows = await db
      .select({ id: shareComments.id, itemKey: shareComments.itemKey })
      .from(shareComments)
      .where(eq(shareComments.shareGalleryId, shareId));
    return Object.fromEntries(rows.map((r) => [r.id, r.itemKey]));
  }

  it("swaps each creative for its newest live version in place, files and comments with it", async () => {
    const v = await seedVersions();
    await seedShare("s1", {
      mcIds: [], assetIds: [], matrix: [],
      creativeIds: [creativeIds[0], v.a1, v.p1, v.z1],
    });
    await db.insert(shareComments).values([
      { id: "k1", shareGalleryId: "s1", itemKey: `c-${v.a1}`, authorName: "Krisz", body: "fix the CTA" },
      { id: "k2", shareGalleryId: "s1", itemKey: `c-${v.a1}`, authorName: "Krisz", body: "old", archivedAt: "2026-11-20 10:00:00" },
      { id: "k3", shareGalleryId: "s1", itemKey: `c-${v.p1}`, authorName: "Krisz", body: "ok" },
    ]);

    const result = await refreshShare(erste.id, "s1");
    expect(result).toMatchObject({
      ok: true,
      replaced: [{ from: v.a1, to: v.a2 }, { from: v.z1, to: v.z2 }],
    });
    expect(result.ok && [...result.newFileIds].sort()).toEqual(["f-a2", "f-z2"]);

    const snap = await readSnapshot("s1");
    // Same places; the jpg 300x250 keeps n1 (its n2 is archived), the zip moves on.
    expect(snap.creatives!.map((c) => c.id)).toEqual([creativeIds[0], v.a2, v.p1, v.z2]);
    expect(snap.files!.map((f) => f.id).sort()).toEqual(["f-a2", "f-p1", "f-z2"]);
    expect(await loadSharedFile("s1", "f-a2")).toMatchObject({ file: { id: "f-a2" } });
    expect(await commentKeys("s1")).toEqual({ k1: `c-${v.a2}`, k2: `c-${v.a2}`, k3: `c-${v.p1}` });

    // Nothing newer the second time.
    expect(await refreshShare(erste.id, "s1")).toMatchObject({ ok: true, replaced: [], newFileIds: [] });
  });

  it("keeps one tile when the newer version is already in the share", async () => {
    const v = await seedVersions();
    await seedShare("s1", { mcIds: [], assetIds: [], matrix: [], creativeIds: [v.a2, v.a1] });
    await db.insert(shareComments).values({
      id: "k1", shareGalleryId: "s1", itemKey: `c-${v.a1}`, authorName: "Krisz", body: "on n1",
    });

    expect(await refreshShare(erste.id, "s1")).toMatchObject({
      ok: true,
      replaced: [{ from: v.a1, to: v.a2 }],
      newFileIds: [],
    });
    const snap = await readSnapshot("s1");
    expect(snap.creatives!.map((c) => c.id)).toEqual([v.a2]);
    expect(snap.files!.map((f) => f.id)).toEqual(["f-a2"]);
    expect(await commentKeys("s1")).toEqual({ k1: `c-${v.a2}` });
  });
});

describe("assets in a share", () => {
  async function seedAssets() {
    await db.insert(uploadedFiles).values([
      { id: "f-logo", clientId: erste.id, filename: "logo.png", originalFilename: "logo.png", storagePath: "x/logo.png", mimeType: "image/png", category: "asset" },
      { id: "f-bg", clientId: erste.id, filename: "bg.jpg", originalFilename: "bg.jpg", storagePath: "x/bg.jpg", mimeType: "image/jpeg", category: "asset" },
    ]);
    const rows = await db
      .insert(assets)
      .values([
        { clientId: erste.id, fileId: "f-logo", fileName: "logo.png", product: "SZA" },
        { clientId: erste.id, fileId: "f-bg", fileName: "bg.jpg", product: "HK" },
      ])
      .returning();
    return rows.map((r) => r.id);
  }

  it("creates an assets-only share whose files pass the share's file gate", async () => {
    const [logo, bg] = await seedAssets();
    const resolved = await resolveShareSelection(erste.id, {
      mcIds: [], assetIds: [bg!, logo!],
      matrix: [],
      creativeIds: [],
    });
    // In the order sent, not the order the rows came back in.
    expect(resolved.assets.map((a) => a.id)).toEqual([bg, logo]);
    expect(resolved.files.map((f) => f.id).sort()).toEqual(["f-bg", "f-logo"]);
    const metadata: SnapshotMetadata = { generatedAt: "2026-10-18T00:00:00Z", ...resolved };
    await db.insert(shareGalleries).values({ id: "sa", clientId: erste.id, metadata: JSON.stringify(metadata) });

    expect(await loadSharedFile("sa", "f-logo")).toMatchObject({ file: { id: "f-logo" }, clientKey: "erste" });
    const [row] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, "sa"));
    expect(shareItemCount(row.metadata)).toBe(2);
    const thumbs = (await shareThumbs(erste.id, [row])).get("sa")!;
    expect(thumbs).toEqual(["/share/sa/file/f-bg?thumb=200", "/share/sa/file/f-logo?thumb=200"]);
  });

  it("adds assets to an existing share and refreshes them", async () => {
    const [logo, bg] = await seedAssets();
    await seedShare("s1", { mcIds: [], assetIds: [logo!], matrix: [], creativeIds: [creativeIds[0]] });
    const add = await resolveShareSelection(erste.id, {
      mcIds: [], assetIds: [logo!, bg!],
      matrix: [],
      creativeIds: [],
    });
    expect(await addToShare(erste.id, "s1", add)).toMatchObject({ ok: true, added: 1, skipped: 1, newFileIds: ["f-bg"] });
    expect((await readSnapshot("s1")).assets!.map((a) => a.id)).toEqual([logo, bg]);

    await db.update(assets).set({ comment: "new" }).where(eq(assets.id, logo!));
    expect(await refreshShare(erste.id, "s1")).toMatchObject({ ok: true, changed: 1 });
    expect((await readSnapshot("s1")).assets!.find((a) => a.id === logo)!.comment).toBe("new");
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
      mcIds: [], assetIds: [],
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
