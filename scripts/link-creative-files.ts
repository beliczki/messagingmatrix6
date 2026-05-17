// Walk storage/{client}/_inbox-creatives/ and _inbox-assets/, match each file
// to a creatives/assets row by exact fileName, copy into the canonical
// storage path, register in uploaded_files with sha256 dedup, and rewrite
// creatives.fileId / assets.fileId to point at the new uploaded_files.id.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/link-creative-files.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/link-creative-files.ts --dry-run
//
// Re-running is safe: any creatives/assets row whose current fileId already
// resolves to an uploaded_files row is skipped.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import fs from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { assets, creatives, uploadedFiles } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { uploadFile } from "../src/lib/entities/files";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
};

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

async function walkFolder(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    await fs.access(root);
  } catch {
    return out;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      const sub = await walkFolder(abs);
      for (const [k, v] of sub) out.set(k, v);
    } else if (e.isFile()) {
      out.set(e.name.toLowerCase(), abs);
    }
  }
  return out;
}

type LinkStats = {
  matched: number;
  alreadyLinked: number;
  noFilenameOnRow: number;
  fileNotInInbox: number;
  errors: string[];
};

function emptyStats(): LinkStats {
  return {
    matched: 0,
    alreadyLinked: 0,
    noFilenameOnRow: 0,
    fileNotInInbox: 0,
    errors: [],
  };
}

async function linkRows(
  table: typeof creatives | typeof assets,
  category: "creative" | "asset",
  inboxMap: Map<string, string>,
  clientId: number,
  dryRun: boolean,
): Promise<LinkStats> {
  const stats = emptyStats();
  const rows = db
    .select()
    .from(table)
    .where(eq(table.clientId, clientId))
    .all();

  for (const row of rows) {
    const fname = row.fileName;
    if (!fname) {
      stats.noFilenameOnRow++;
      continue;
    }

    if (row.fileId) {
      const ok = db
        .select({ id: uploadedFiles.id })
        .from(uploadedFiles)
        .where(
          and(
            eq(uploadedFiles.clientId, clientId),
            eq(uploadedFiles.id, row.fileId),
          ),
        )
        .get();
      if (ok) {
        stats.alreadyLinked++;
        continue;
      }
    }

    const abs = inboxMap.get(fname.toLowerCase());
    if (!abs) {
      stats.fileNotInInbox++;
      continue;
    }

    if (dryRun) {
      stats.matched++;
      continue;
    }

    try {
      const buffer = await fs.readFile(abs);
      const stat = await fs.stat(abs);
      const mtimeIso = stat.mtime.toISOString();
      const uploaded = await uploadFile(clientId, {
        buffer,
        originalFilename: fname,
        mimeType: mimeFor(fname),
        category,
        uploadedBy: "import-script",
        dimensions: row.fileDimensions ?? undefined,
      });
      db.update(table)
        .set({ fileId: uploaded.id, createdAt: mtimeIso, updatedAt: mtimeIso })
        .where(and(eq(table.clientId, clientId), eq(table.id, row.id)))
        .run();
      stats.matched++;
    } catch (e) {
      stats.errors.push(`${fname}: ${(e as Error).message}`);
    }
  }

  return stats;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`Dry run: ${dryRun}`);

  const storageRoot = path.resolve(process.cwd(), "storage", client.key);
  const creativesInbox = path.join(storageRoot, "_inbox-creatives");
  const assetsInbox = path.join(storageRoot, "_inbox-assets");

  console.log(`\nIndexing inbox folders…`);
  const creativesMap = await walkFolder(creativesInbox);
  const assetsMap = await walkFolder(assetsInbox);
  console.log(`  ${creativesInbox}: ${creativesMap.size} files`);
  console.log(`  ${assetsInbox}: ${assetsMap.size} files`);

  console.log(`\nLinking creatives…`);
  const cStats = await linkRows(
    creatives,
    "creative",
    creativesMap,
    client.id,
    dryRun,
  );
  console.log(`  matched         ${cStats.matched}`);
  console.log(`  already linked  ${cStats.alreadyLinked}`);
  console.log(`  no filename     ${cStats.noFilenameOnRow}`);
  console.log(`  not in inbox    ${cStats.fileNotInInbox}`);
  if (cStats.errors.length) {
    console.log(`  errors          ${cStats.errors.length}`);
    for (const e of cStats.errors.slice(0, 10)) console.log(`    · ${e}`);
  }

  console.log(`\nLinking assets…`);
  const aStats = await linkRows(
    assets,
    "asset",
    assetsMap,
    client.id,
    dryRun,
  );
  console.log(`  matched         ${aStats.matched}`);
  console.log(`  already linked  ${aStats.alreadyLinked}`);
  console.log(`  no filename     ${aStats.noFilenameOnRow}`);
  console.log(`  not in inbox    ${aStats.fileNotInInbox}`);
  if (aStats.errors.length) {
    console.log(`  errors          ${aStats.errors.length}`);
    for (const e of aStats.errors.slice(0, 10)) console.log(`    · ${e}`);
  }

  getSqlite().close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
