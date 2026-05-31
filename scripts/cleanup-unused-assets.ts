// Delete asset library rows + uploaded_files rows + physical files for assets
// that no message in the matrix references. "Referenced" = the filename appears
// in any messages.image1..image6 / video1 cell (archived rows included as a
// safety net, since restoring an archived message would re-link).
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/cleanup-unused-assets.ts           # dry-run
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/cleanup-unused-assets.ts --apply   # delete
//
// Scope is the active client only (Q3 locked: Erste). Filename match is
// case-insensitive (macOS FS is case-insensitive; v5 had mixed-case names).
//
// Hard-delete model (Q2 locked):
//   1. DELETE assets rows whose file_id points to a doomed uploaded_files row
//      (or whose file_name doesn't appear in any message reference).
//   2. DELETE uploaded_files rows (category='asset') whose filename isn't
//      referenced.
//   3. For each doomed storage_path: only fs.unlink if no surviving
//      uploaded_files row anywhere (any client, any category) still points at
//      it. Intra-client sha256 dedup means several logical rows can share one
//      physical file.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { and, eq, inArray } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { assets, messages, uploadedFiles, clients, config as configTable } from "../src/db/schema";
import { deleteStorageFile, resolveStoragePath } from "../src/lib/storage";
import fs from "node:fs/promises";

const APPLY = process.argv.includes("--apply");

function logBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const clientKey = process.env.ACTIVE_CLIENT_KEY;
  if (!clientKey) {
    console.error("ACTIVE_CLIENT_KEY env var required (e.g. erste)");
    process.exit(1);
  }
  const client = db
    .select()
    .from(clients)
    .where(eq(clients.key, clientKey))
    .get();
  if (!client) {
    console.error(`Client not found: ${clientKey}`);
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? "APPLY (will delete)" : "DRY-RUN (no changes)"}`);
  console.log(`Client: ${client.key} (id=${client.id})`);

  // 1. Collect referenced filenames from messages.image1..6 / video1.
  const refRows = db
    .select({
      image1: messages.image1,
      image2: messages.image2,
      image3: messages.image3,
      image4: messages.image4,
      image5: messages.image5,
      image6: messages.image6,
      video1: messages.video1,
    })
    .from(messages)
    .where(eq(messages.clientId, client.id))
    .all();

  const referenced = new Set<string>();
  const addRef = (v: string | null | undefined) => {
    if (!v) return;
    const t = v.trim();
    if (!t) return;
    referenced.add(t.toLowerCase());
  };
  for (const r of refRows) {
    addRef(r.image1);
    addRef(r.image2);
    addRef(r.image3);
    addRef(r.image4);
    addRef(r.image5);
    addRef(r.image6);
    addRef(r.video1);
  }

  // Safety: also pick up filenames from config.lookAndFeel.logo if set.
  const lookRow = db
    .select()
    .from(configTable)
    .where(and(eq(configTable.clientId, client.id), eq(configTable.key, "lookAndFeel")))
    .get();
  if (lookRow) {
    try {
      const parsed = JSON.parse(lookRow.value);
      if (parsed && typeof parsed.logo === "string") addRef(parsed.logo);
    } catch {
      // malformed JSON — ignore (won't gate the cleanup)
    }
  }

  console.log(`Referenced filenames (matrix + lookAndFeel.logo): ${referenced.size}`);

  // 2. Find candidate uploaded_files (category='asset' for this client whose
  //    filename isn't in the referenced set).
  const allAssetFiles = db
    .select()
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.clientId, client.id), eq(uploadedFiles.category, "asset")))
    .all();

  const doomedFiles = allAssetFiles.filter(
    (f) => !referenced.has(f.filename.toLowerCase()),
  );
  const doomedFileIds = new Set(doomedFiles.map((f) => f.id));
  const doomedStoragePaths = new Set(doomedFiles.map((f) => f.storagePath));

  // 3. Find candidate assets-library rows:
  //    - file_id points to a doomed file, OR
  //    - file_name is not in the referenced set (orphan rows w/o a file_id).
  const allAssets = db
    .select()
    .from(assets)
    .where(eq(assets.clientId, client.id))
    .all();
  const doomedAssetRows = allAssets.filter((a) => {
    if (a.fileId && doomedFileIds.has(a.fileId)) return true;
    if (!a.fileId && a.fileName && !referenced.has(a.fileName.toLowerCase())) return true;
    return false;
  });

  // 4. Of the doomed storage_paths, figure out which ones can be physically
  //    removed: a storage_path is safe to unlink only if NO surviving
  //    uploaded_files row (any client, any category) still points at it.
  //    Intra-client sha256 dedup means one physical file may back several
  //    logical rows.
  const survivingPaths = new Set<string>();
  if (doomedStoragePaths.size > 0) {
    const survivors = db
      .select({ storagePath: uploadedFiles.storagePath, id: uploadedFiles.id })
      .from(uploadedFiles)
      .where(inArray(uploadedFiles.storagePath, [...doomedStoragePaths]))
      .all();
    for (const s of survivors) {
      if (!doomedFileIds.has(s.id)) survivingPaths.add(s.storagePath);
    }
  }
  const unlinkPaths = [...doomedStoragePaths].filter((p) => !survivingPaths.has(p));

  // 5. Tally byte size of the to-be-unlinked files.
  let bytesToFree = 0;
  for (const f of doomedFiles) {
    if (!survivingPaths.has(f.storagePath)) bytesToFree += f.sizeBytes ?? 0;
  }

  console.log("");
  console.log("=== Cleanup summary ===");
  console.log(`uploaded_files (asset) rows total: ${allAssetFiles.length}`);
  console.log(`  to delete:                       ${doomedFiles.length}`);
  console.log(`  to keep:                         ${allAssetFiles.length - doomedFiles.length}`);
  console.log(`assets (library) rows total:       ${allAssets.length}`);
  console.log(`  to delete:                       ${doomedAssetRows.length}`);
  console.log(`  to keep:                         ${allAssets.length - doomedAssetRows.length}`);
  console.log(`Physical files to unlink:          ${unlinkPaths.length}`);
  console.log(`  (kept due to shared storage:     ${doomedStoragePaths.size - unlinkPaths.length})`);
  console.log(`Disk space to free:                ${logBytes(bytesToFree)}`);

  if (doomedFiles.length > 0) {
    console.log("");
    console.log("Sample of doomed filenames (first 10):");
    for (const f of doomedFiles.slice(0, 10)) {
      console.log(`  - ${f.filename}  (${f.storagePath})`);
    }
  }

  if (!APPLY) {
    console.log("");
    console.log("Dry-run only. Re-run with --apply to actually delete.");
    return;
  }

  // === APPLY ===
  console.log("");
  console.log("Applying changes...");

  const sqlite = getSqlite();
  sqlite.exec("BEGIN");
  try {
    if (doomedAssetRows.length > 0) {
      const ids = doomedAssetRows.map((a) => a.id);
      // Chunk to stay under SQLite's parameter limit (default 999).
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        db.delete(assets).where(inArray(assets.id, chunk)).run();
      }
    }
    if (doomedFiles.length > 0) {
      const ids = doomedFiles.map((f) => f.id);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        db.delete(uploadedFiles).where(inArray(uploadedFiles.id, chunk)).run();
      }
    }
    sqlite.exec("COMMIT");
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
  console.log(`Deleted ${doomedAssetRows.length} assets rows and ${doomedFiles.length} uploaded_files rows.`);

  let unlinked = 0;
  let missing = 0;
  for (const p of unlinkPaths) {
    try {
      await fs.access(resolveStoragePath(p));
    } catch {
      missing++;
      continue;
    }
    await deleteStorageFile(p);
    unlinked++;
  }
  console.log(`Unlinked ${unlinked} physical files (${missing} were already missing on disk).`);
  console.log(`Freed approx ${logBytes(bytesToFree)}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
