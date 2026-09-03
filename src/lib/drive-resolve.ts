import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { creatives, nowUtc } from "@/db/schema";
import { getDriveFolder, listDriveFolder, type DriveFile } from "@/lib/drive";

// Resolve a creative's direct Drive file link from the parent folder link the
// user pasted. Folder -> children is the only direction the API key can walk
// (it never returns `parents`), so every lookup starts at a folder and matches
// on file_name.
//
// The outcomes are deliberately separate: a folder that is not link-shared
// answers files.list with an empty list, so without the getDriveFolder() probe
// a sharing problem would be reported as "file not found" and the user would
// hunt for a file that is sitting right there.

export type ResolveOutcome =
  | "resolved" // file id written (new, or changed since last check)
  | "unchanged" // the same file id was already stored
  | "no_folder" // nothing to look in — the creative has no folder link
  | "folder_unreachable" // 404: deleted, wrong id, or not shared with the link
  | "file_not_found" // folder listed fine, no file carries this name
  | "ambiguous"; // several files share the name — we refuse to guess

export type ResolveResult = {
  creativeId: number;
  fileName: string | null;
  folderId: string | null;
  folderName: string | null;
  driveFileId: string | null;
  outcome: ResolveOutcome;
};

export type ResolveReport = {
  counts: Record<ResolveOutcome, number>;
  results: ResolveResult[];
};

const EMPTY_COUNTS: Record<ResolveOutcome, number> = {
  resolved: 0,
  unchanged: 0,
  no_folder: 0,
  folder_unreachable: 0,
  file_not_found: 0,
  ambiguous: 0,
};

type FolderContents = { name: string; byName: Map<string, DriveFile[]> };

/** One listing per folder per run — creatives arrive in whole delivery batches,
 *  so the same folder would otherwise be listed dozens of times. */
export function createFolderCache() {
  const cache = new Map<string, FolderContents | null>();
  return async function load(folderId: string): Promise<FolderContents | null> {
    const hit = cache.get(folderId);
    if (hit !== undefined) return hit;
    const folder = await getDriveFolder(folderId);
    if (!folder) {
      cache.set(folderId, null);
      return null;
    }
    const byName = new Map<string, DriveFile[]>();
    for (const f of await listDriveFolder(folderId)) {
      // Sub-folders are skipped: every creative in this client is a plain
      // png/jpg/mp4/mov file. An HTML5 bundle (a folder in Drive) would need
      // its own link shape, so it must not be matched here by accident.
      if (f.mimeType === "application/vnd.google-apps.folder") continue;
      const list = byName.get(f.name);
      if (list) list.push(f);
      else byName.set(f.name, [f]);
    }
    const contents = { name: folder.name, byName };
    cache.set(folderId, contents);
    return contents;
  };
}

/** Look up the stored folder of each given creative and fill in its file link. */
export async function resolveDriveFilesForCreatives(
  clientId: number,
  creativeIds: number[],
): Promise<ResolveReport> {
  if (creativeIds.length === 0) return { counts: { ...EMPTY_COUNTS }, results: [] };

  const rows = await db
    .select({
      id: creatives.id,
      fileName: creatives.fileName,
      driveFolderId: creatives.driveFolderId,
      driveFolderName: creatives.driveFolderName,
      driveFileId: creatives.driveFileId,
    })
    .from(creatives)
    .where(and(eq(creatives.clientId, clientId), inArray(creatives.id, creativeIds)));

  const loadFolder = createFolderCache();
  const results: ResolveResult[] = [];

  for (const row of rows) {
    if (!row.driveFolderId || !row.fileName) {
      results.push({
        creativeId: row.id,
        fileName: row.fileName,
        folderId: row.driveFolderId,
        folderName: row.driveFolderName,
        driveFileId: row.driveFileId,
        outcome: "no_folder",
      });
      continue;
    }
    const folder = await loadFolder(row.driveFolderId);
    if (!folder) {
      results.push({
        creativeId: row.id,
        fileName: row.fileName,
        folderId: row.driveFolderId,
        folderName: row.driveFolderName,
        driveFileId: row.driveFileId,
        outcome: "folder_unreachable",
      });
      continue;
    }
    const matches = folder.byName.get(row.fileName) ?? [];
    const outcome: ResolveOutcome =
      matches.length === 0
        ? "file_not_found"
        : matches.length > 1
          ? "ambiguous"
          : matches[0].id === row.driveFileId
            ? "unchanged"
            : "resolved";
    results.push({
      creativeId: row.id,
      fileName: row.fileName,
      folderId: row.driveFolderId,
      folderName: folder.name,
      driveFileId: outcome === "resolved" || outcome === "unchanged" ? matches[0].id : row.driveFileId,
      outcome,
    });
  }

  await persist(clientId, results);

  const counts = { ...EMPTY_COUNTS };
  for (const r of results) counts[r.outcome] += 1;
  return { counts, results };
}

/** Two statements, not one per creative: a health check runs over hundreds of
 *  rows and every round trip crosses the SSH tunnel. Only the machine-owned
 *  drive_* columns move — `version` and `updated_at` belong to user edits, and
 *  bumping them here would fake activity and fight the editor's optimistic lock. */
async function persist(clientId: number, results: ResolveResult[]) {
  const written = results.filter((r) => r.outcome === "resolved");
  const touched = results.filter(
    (r) => r.outcome !== "resolved" && r.outcome !== "no_folder",
  );

  if (written.length > 0) {
    const values = sql.join(
      written.map(
        (r) =>
          sql`(${r.creativeId}::integer, ${r.driveFileId}::text, ${r.folderName}::text)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE ${creatives} SET
        drive_file_id = v.file_id,
        drive_folder_name = v.folder_name,
        drive_checked_at = ${nowUtc}
      FROM (VALUES ${values}) AS v(id, file_id, folder_name)
      WHERE ${creatives.id} = v.id AND ${creatives.clientId} = ${clientId}
    `);
  }

  if (touched.length > 0) {
    // Unreachable folders keep whatever name was stored — we did not see one.
    const named = touched.filter((r) => r.folderName !== null);
    if (named.length > 0) {
      const values = sql.join(
        named.map((r) => sql`(${r.creativeId}::integer, ${r.folderName}::text)`),
        sql`, `,
      );
      await db.execute(sql`
        UPDATE ${creatives} SET
          drive_folder_name = v.folder_name,
          drive_checked_at = ${nowUtc}
        FROM (VALUES ${values}) AS v(id, folder_name)
        WHERE ${creatives.id} = v.id AND ${creatives.clientId} = ${clientId}
      `);
    }
    const unnamed = touched.filter((r) => r.folderName === null).map((r) => r.creativeId);
    if (unnamed.length > 0) {
      await db
        .update(creatives)
        .set({ driveCheckedAt: nowUtc })
        .where(and(eq(creatives.clientId, clientId), inArray(creatives.id, unnamed)));
    }
  }
}

// ---------------------------------------------------------------------------
// The other direction: start from folder links the user hands over (the
// backfill). Older creatives carry no folder at all, and a file id can never be
// walked back to its parent, so the only way to fill them in is to open the
// delivery folders and match their contents against file_name.

export type LinkOutcome =
  | "linked" // folder (and file) written on a creative that had neither
  | "unchanged" // already pointed at this exact folder and file
  | "conflict" // creative claims a different folder — left alone
  | "ambiguous_creative" // several creatives carry this file name
  | "no_creative"; // a Drive file nothing in the library refers to

export type LinkResult = {
  folderId: string;
  fileName: string;
  driveFileId: string;
  creativeId: number | null;
  outcome: LinkOutcome;
};

export type LinkReport = {
  counts: Record<LinkOutcome, number>;
  unreachableFolders: string[];
  results: LinkResult[];
};

const EMPTY_LINK_COUNTS: Record<LinkOutcome, number> = {
  linked: 0,
  unchanged: 0,
  conflict: 0,
  ambiguous_creative: 0,
  no_creative: 0,
};

export async function linkCreativesFromFolders(
  clientId: number,
  folderIds: string[],
  opts: { apply?: boolean; overwrite?: boolean } = {},
): Promise<LinkReport> {
  const loadFolder = createFolderCache();
  const results: LinkResult[] = [];
  const unreachableFolders: string[] = [];

  for (const folderId of folderIds) {
    const folder = await loadFolder(folderId);
    if (!folder) {
      unreachableFolders.push(folderId);
      continue;
    }
    const names = [...folder.byName.keys()];
    if (names.length === 0) continue;

    // Bounded by one folder's contents, so this read cannot silently truncate.
    const rows = await db
      .select({
        id: creatives.id,
        fileName: creatives.fileName,
        driveFolderId: creatives.driveFolderId,
        driveFileId: creatives.driveFileId,
      })
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), inArray(creatives.fileName, names)));

    const byName = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.fileName!;
      const list = byName.get(key);
      if (list) list.push(r);
      else byName.set(key, [r]);
    }

    for (const [name, files] of folder.byName) {
      const driveFileId = files[0].id;
      const candidates = byName.get(name) ?? [];
      if (candidates.length === 0) {
        results.push({ folderId, fileName: name, driveFileId, creativeId: null, outcome: "no_creative" });
        continue;
      }
      if (candidates.length > 1) {
        results.push({
          folderId,
          fileName: name,
          driveFileId,
          creativeId: null,
          outcome: "ambiguous_creative",
        });
        continue;
      }
      const c = candidates[0];
      if (c.driveFolderId === folderId && c.driveFileId === driveFileId) {
        results.push({ folderId, fileName: name, driveFileId, creativeId: c.id, outcome: "unchanged" });
        continue;
      }
      if (c.driveFolderId !== null && c.driveFolderId !== folderId && !opts.overwrite) {
        // The creative already claims another folder. Silently repointing it
        // would hide a real duplicate-delivery question, so it is reported.
        results.push({ folderId, fileName: name, driveFileId, creativeId: c.id, outcome: "conflict" });
        continue;
      }
      if (opts.apply) {
        await db
          .update(creatives)
          .set({
            driveFolderId: folderId,
            driveFolderName: folder.name,
            driveFileId,
            driveCheckedAt: nowUtc,
          })
          .where(and(eq(creatives.clientId, clientId), eq(creatives.id, c.id)));
      }
      results.push({ folderId, fileName: name, driveFileId, creativeId: c.id, outcome: "linked" });
    }
  }

  const counts = { ...EMPTY_LINK_COUNTS };
  for (const r of results) counts[r.outcome] += 1;
  return { counts, unreachableFolders, results };
}
