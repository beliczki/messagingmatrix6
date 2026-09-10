import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, creatives, uploadedFiles } from "@/db/schema";
import { listCreativeMatchesForMcs } from "@/lib/entities/creatives";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let other: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [other] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

let seq = 0;
async function file(clientId: number, mimeType: string | null) {
  seq += 1;
  const id = `f${seq}`;
  await db.insert(uploadedFiles).values({
    id,
    clientId,
    filename: `${id}.bin`,
    originalFilename: `${id}.bin`,
    storagePath: `/tmp/${id}`,
    mimeType,
    category: "creative",
  });
  return id;
}

async function creative(over: Partial<typeof creatives.$inferInsert> = {}) {
  const [row] = await db
    .insert(creatives)
    .values({
      clientId: erste.id,
      mcNumber: 404,
      mcVariant: "b",
      fileName: "ERSTE_HK_MC404_b_easypay_n1_300x250.png",
      fileDimensions: "300x250",
      type: "image",
      ...over,
    })
    .returning();
  return row;
}

describe("listCreativeMatchesForMcs", () => {
  it("answers for several MCs in one call", async () => {
    await creative();
    await creative({ mcVariant: "a" });
    await creative({ mcVariant: "a", fileDimensions: "970x250" });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "a" },
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|a")?.total).toBe(2);
    expect(m.get("404|b")?.total).toBe(1);
  });

  it("returns nothing for an empty pair list, without querying", async () => {
    await creative();
    expect(await listCreativeMatchesForMcs(erste.id, [])).toEqual(new Map());
  });

  it("skips archived creatives and other clients", async () => {
    await creative({ archivedAt: "2026-09-01 00:00:00" });
    await creative({ clientId: other.id });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")).toBeUndefined();
  });

  it("takes the 300x250 as the cover, and only that size", async () => {
    await creative({
      fileName: "ERSTE_HK_MC404_b_easypay_n1_1080x1080.png",
      fileDimensions: "1080x1080",
    });
    const wanted = await creative();

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")?.cover?.id).toBe(wanted.id);
  });

  it("has no cover when nothing was delivered at 300x250", async () => {
    await creative({
      fileName: "ERSTE_HK_MC404_b_easypay_n1_1080x1080.png",
      fileDimensions: "1080x1080",
    });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")).toMatchObject({ total: 1, cover: null });
  });

  it("reads a video's size off its filename — sharp never measured one", async () => {
    const fileId = await file(erste.id, "video/mp4");
    await creative({
      fileId,
      fileName: "ERSTE_HK_MC404_b_easypay_n1_1080x1080.mp4",
      fileDimensions: null,
      type: "video",
    });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")).toMatchObject({ total: 1, videoCount: 1 });
    expect(m.get("404|b")?.items[0]?.dimensions).toBe("1080x1080");
  });

  it("still recognises a video with no uploaded file behind it", async () => {
    await creative({
      fileId: null,
      fileName: "ERSTE_HK_MC404_b_easypay_n1_640x360.mp4",
      fileDimensions: null,
      type: "video",
    });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")?.videoCount).toBe(1);
  });

  it("does not count an image as a video when the file says image", async () => {
    const fileId = await file(erste.id, "image/png");
    await creative({ fileId });

    const m = await listCreativeMatchesForMcs(erste.id, [
      { number: 404, variant: "b" },
    ]);
    expect(m.get("404|b")?.videoCount).toBe(0);
  });
});
