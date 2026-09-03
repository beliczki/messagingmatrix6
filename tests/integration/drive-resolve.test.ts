import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, creatives } from "@/db/schema";
import { createTestDb, type TestDb } from "../helpers/test-db";

// The Drive API itself is stubbed: what this test pins down is the mapping from
// what a folder contains to what lands in the drive_* columns — including the
// two cases the real API cannot tell apart on its own (unreachable folder vs.
// missing file), which is the whole reason the resolver probes the folder.
const folders = vi.hoisted(() => ({
  reachable: new Map<string, string>(), // folderId -> folder name
  contents: new Map<
    string,
    { id: string; name: string; mimeType: string }[]
  >(),
  listCalls: [] as string[],
}));

vi.mock("@/lib/drive", () => ({
  getDriveFolder: async (id: string) => {
    const name = folders.reachable.get(id);
    return name ? { id, name } : null;
  },
  listDriveFolder: async (id: string) => {
    folders.listCalls.push(id);
    return folders.contents.get(id) ?? [];
  },
}));

const { resolveDriveFilesForCreatives, linkCreativesFromFolders } = await import(
  "@/lib/drive-resolve",
);

const FOLDER = "1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe";
const HIDDEN = "1tuQ6YMD1CzydhUPDVYylReNXwYuO7QgH";

let h: TestDb;
let erste: { id: number };
let other: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [other] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
  folders.reachable.clear();
  folders.contents.clear();
  folders.listCalls.length = 0;
  folders.reachable.set(FOLDER, "Leadas 04 13");
});

afterEach(async () => {
  await h.cleanup();
});

function file(name: string, id: string, mimeType = "image/jpeg") {
  return { id, name, mimeType };
}

async function creative(
  fileName: string,
  over: Partial<typeof creatives.$inferInsert> = {},
) {
  const [row] = await db
    .insert(creatives)
    .values({ clientId: erste.id, fileName, ...over })
    .returning();
  return row;
}

async function reload(id: number) {
  const [row] = await db.select().from(creatives).where(eq(creatives.id, id));
  return row;
}

describe("resolveDriveFilesForCreatives", () => {
  it("writes the file id, the folder name and the check time on a match", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg", { driveFolderId: FOLDER });

    const report = await resolveDriveFilesForCreatives(erste.id, [c.id]);

    expect(report.counts.resolved).toBe(1);
    const row = await reload(c.id);
    expect(row.driveFileId).toBe("FILE1");
    expect(row.driveFolderName).toBe("Leadas 04 13");
    expect(row.driveCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("leaves a user edit alone: version and updated_at do not move", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg", { driveFolderId: FOLDER });

    await resolveDriveFilesForCreatives(erste.id, [c.id]);

    const row = await reload(c.id);
    expect(row.version).toBe(c.version);
    expect(row.updatedAt).toBe(c.updatedAt);
  });

  it("reports an already-correct row as unchanged", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg", {
      driveFolderId: FOLDER,
      driveFileId: "FILE1",
    });

    const report = await resolveDriveFilesForCreatives(erste.id, [c.id]);
    expect(report.counts.unchanged).toBe(1);
    expect(report.counts.resolved).toBe(0);
  });

  it("separates an unreachable folder from a missing file", async () => {
    folders.contents.set(FOLDER, [file("other.jpg", "FILE2")]);
    const missing = await creative("banner_300x250.jpg", { driveFolderId: FOLDER });
    const hidden = await creative("banner_300x250.jpg", { driveFolderId: HIDDEN });

    const report = await resolveDriveFilesForCreatives(erste.id, [
      missing.id,
      hidden.id,
    ]);

    expect(report.counts.file_not_found).toBe(1);
    expect(report.counts.folder_unreachable).toBe(1);
    // Both were checked, neither got a file id — but only the reachable one
    // learned its folder name.
    expect((await reload(missing.id)).driveFolderName).toBe("Leadas 04 13");
    expect((await reload(hidden.id)).driveFolderName).toBeNull();
    expect((await reload(hidden.id)).driveCheckedAt).not.toBeNull();
  });

  it("refuses to guess when two files share the name", async () => {
    folders.contents.set(FOLDER, [
      file("banner_300x250.jpg", "FILE1"),
      file("banner_300x250.jpg", "FILE2"),
    ]);
    const c = await creative("banner_300x250.jpg", { driveFolderId: FOLDER });

    const report = await resolveDriveFilesForCreatives(erste.id, [c.id]);

    expect(report.counts.ambiguous).toBe(1);
    expect((await reload(c.id)).driveFileId).toBeNull();
  });

  it("never matches a sub-folder that happens to carry the name", async () => {
    folders.contents.set(FOLDER, [
      file("banner_300x250", "FOLDER1", "application/vnd.google-apps.folder"),
    ]);
    const c = await creative("banner_300x250", { driveFolderId: FOLDER });

    const report = await resolveDriveFilesForCreatives(erste.id, [c.id]);
    expect(report.counts.file_not_found).toBe(1);
  });

  it("skips creatives with no folder link and does not touch them", async () => {
    const c = await creative("banner_300x250.jpg");
    const report = await resolveDriveFilesForCreatives(erste.id, [c.id]);
    expect(report.counts.no_folder).toBe(1);
    expect((await reload(c.id)).driveCheckedAt).toBeNull();
  });

  it("lists each folder once no matter how many creatives share it", async () => {
    folders.contents.set(FOLDER, [
      file("a.jpg", "FILE_A"),
      file("b.jpg", "FILE_B"),
    ]);
    const a = await creative("a.jpg", { driveFolderId: FOLDER });
    const b = await creative("b.jpg", { driveFolderId: FOLDER });

    await resolveDriveFilesForCreatives(erste.id, [a.id, b.id]);

    expect(folders.listCalls).toEqual([FOLDER]);
  });

  it("cannot reach across clients", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const [foreign] = await db
      .insert(creatives)
      .values({
        clientId: other.id,
        fileName: "banner_300x250.jpg",
        driveFolderId: FOLDER,
      })
      .returning();

    const report = await resolveDriveFilesForCreatives(erste.id, [foreign.id]);

    expect(report.results).toHaveLength(0);
    expect((await reload(foreign.id)).driveFileId).toBeNull();
  });
});

describe("linkCreativesFromFolders", () => {
  it("writes folder and file onto a creative that had neither — but only with --apply", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg");

    const dry = await linkCreativesFromFolders(erste.id, [FOLDER]);
    expect(dry.counts.linked).toBe(1);
    expect((await reload(c.id)).driveFolderId).toBeNull();

    const applied = await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true });
    expect(applied.counts.linked).toBe(1);
    const row = await reload(c.id);
    expect(row.driveFolderId).toBe(FOLDER);
    expect(row.driveFileId).toBe("FILE1");
    expect(row.driveFolderName).toBe("Leadas 04 13");
  });

  it("does not repoint a creative that already claims another folder", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg", {
      driveFolderId: "1X5REqolO_AlLArTPojUZKVSUwKQjap20",
      driveFileId: "OLD",
    });

    const report = await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true });

    expect(report.counts.conflict).toBe(1);
    expect((await reload(c.id)).driveFileId).toBe("OLD");
  });

  it("repoints it when overwrite is asked for explicitly", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const c = await creative("banner_300x250.jpg", {
      driveFolderId: "1X5REqolO_AlLArTPojUZKVSUwKQjap20",
      driveFileId: "OLD",
    });

    await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true, overwrite: true });

    expect((await reload(c.id)).driveFileId).toBe("FILE1");
  });

  it("refuses to pick when two creatives share the file name", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const a = await creative("banner_300x250.jpg");
    const b = await creative("banner_300x250.jpg");

    const report = await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true });

    expect(report.counts.ambiguous_creative).toBe(1);
    expect((await reload(a.id)).driveFolderId).toBeNull();
    expect((await reload(b.id)).driveFolderId).toBeNull();
  });

  it("reports a Drive file no creative refers to", async () => {
    folders.contents.set(FOLDER, [file("stranger.jpg", "FILE9")]);
    const report = await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true });
    expect(report.counts.no_creative).toBe(1);
  });

  it("names the folders it could not open instead of counting them as misses", async () => {
    const report = await linkCreativesFromFolders(erste.id, [HIDDEN], { apply: true });
    expect(report.unreachableFolders).toEqual([HIDDEN]);
    expect(report.results).toHaveLength(0);
  });

  it("stays inside the client", async () => {
    folders.contents.set(FOLDER, [file("banner_300x250.jpg", "FILE1")]);
    const [foreign] = await db
      .insert(creatives)
      .values({ clientId: other.id, fileName: "banner_300x250.jpg" })
      .returning();

    const report = await linkCreativesFromFolders(erste.id, [FOLDER], { apply: true });

    expect(report.counts.no_creative).toBe(1);
    const [row] = await db.select().from(creatives).where(eq(creatives.id, foreign.id));
    expect(row.driveFolderId).toBeNull();
  });
});
