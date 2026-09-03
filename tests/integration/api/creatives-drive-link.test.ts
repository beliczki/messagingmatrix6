import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives } from "@/db/schema";
import {
  createCreative,
  CreativeError,
  getCreative,
  pickWritable,
  updateCreative,
} from "@/lib/entities/creatives";
import { createTestDb, type TestDb } from "../../helpers/test-db";

const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";
const OTHER_FOLDER = "1X5REqolO_AlLArTPojUZKVSUwKQjap20";

let h: TestDb;
let erste: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
});

afterEach(async () => {
  await h.cleanup();
});

/** A creative that the resolver has already been through. */
async function resolved() {
  const row = await createCreative(erste.id, {
    fileName: "banner_300x250.jpg",
    driveFolderId: FOLDER,
  });
  await db
    .update(creatives)
    .set({
      driveFileId: "FILE1",
      driveFolderName: "Leadas 04 13",
      driveCheckedAt: "2026-09-03 10:00:00",
    })
    .where(eq(creatives.id, row.id));
  return row;
}

describe("pickWritable — the pasted folder link", () => {
  it("stores the id, not the pasted string", () => {
    expect(
      pickWritable({
        driveFolderUrl: `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`,
      }).driveFolderId,
    ).toBe(FOLDER);
  });

  it("clears the folder on an empty value", () => {
    expect(pickWritable({ driveFolderUrl: "" }).driveFolderId).toBeNull();
  });

  it("rejects anything that is not a folder link", () => {
    expect(() => pickWritable({ driveFolderUrl: "https://example.com/x" })).toThrow(
      CreativeError,
    );
    expect(() =>
      pickWritable({ driveFolderUrl: "https://drive.google.com/file/d/FILE1/view" }),
    ).toThrow(CreativeError);
  });

  it("leaves the folder untouched when the body does not mention it", () => {
    expect("driveFolderId" in pickWritable({ brand: "Erste" })).toBe(false);
  });

  it("refuses the computed columns — only the resolver writes those", () => {
    const input = pickWritable({
      driveFileId: "HAND_WRITTEN",
      driveFolderName: "Made up",
      driveCheckedAt: "2026-01-01 00:00:00",
    }) as Record<string, unknown>;
    expect(input.driveFileId).toBeUndefined();
    expect(input.driveFolderName).toBeUndefined();
    expect(input.driveCheckedAt).toBeUndefined();
  });
});

describe("updateCreative — moving the folder", () => {
  it("drops the resolved file link when the folder changes", async () => {
    const row = await resolved();
    const r = await updateCreative(erste.id, row.id, row.version, {
      driveFolderId: OTHER_FOLDER,
    });

    expect(r.ok).toBe(true);
    const after = await getCreative(erste.id, row.id);
    expect(after?.driveFolderId).toBe(OTHER_FOLDER);
    expect(after?.driveFileId).toBeNull();
    expect(after?.driveFolderName).toBeNull();
    expect(after?.driveCheckedAt).toBeNull();
  });

  it("drops it when the folder is cleared", async () => {
    const row = await resolved();
    await updateCreative(erste.id, row.id, row.version, { driveFolderId: null });

    const after = await getCreative(erste.id, row.id);
    expect(after?.driveFolderId).toBeNull();
    expect(after?.driveFileId).toBeNull();
  });

  it("keeps it when the same folder is saved again", async () => {
    const row = await resolved();
    await updateCreative(erste.id, row.id, row.version, {
      driveFolderId: FOLDER,
      comment: "typo fix",
    });

    const after = await getCreative(erste.id, row.id);
    expect(after?.driveFileId).toBe("FILE1");
    expect(after?.driveFolderName).toBe("Leadas 04 13");
  });

  it("keeps it when an unrelated field is edited", async () => {
    const row = await resolved();
    await updateCreative(erste.id, row.id, row.version, { comment: "hello" });

    const after = await getCreative(erste.id, row.id);
    expect(after?.driveFileId).toBe("FILE1");
  });
});
