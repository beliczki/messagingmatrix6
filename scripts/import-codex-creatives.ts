// One-off bulk import of the Codex-curated Erste creative collection into the
// creative library, directly at DB + object-store level. Source of truth:
//   ~/ERSTE Addressable AI Agent/creatives/  (flat files, canonical names,
//   original mtimes preserved — mtime becomes creatives.created_at/updated_at)
//
// Top-level files only; directories (the *.htmlFolder creatives) are skipped
// per plan. Additive + idempotent: files whose file_name already exists in the
// active client's creatives table are skipped, never wiped.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-codex-creatives.ts --dry-run
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-codex-creatives.ts --limit 5
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-codex-creatives.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db, getClient } from "../src/db";
import { creatives } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { uploadFile } from "../src/lib/entities/files";
import { parseCreativeFilename } from "../src/lib/parse-creative-filename";

const SOURCE_DIR = path.join(os.homedir(), "ERSTE Addressable AI Agent", "creatives");

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  zip: "application/zip",
  pdf: "application/pdf",
};

// App timestamp format (matches the DB default nowUtc): UTC, space-separated.
function toUtcTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

type Args = { dryRun: boolean; limit: number | null };

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") out.limit = parseInt(argv[++i]!, 10);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: npx tsx scripts/import-codex-creatives.ts [--dry-run] [--limit N]");
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function actualImageDimensions(buffer: Buffer): Promise<string | null> {
  try {
    const md = await sharp(buffer).metadata();
    if (md.width && md.height) return `${md.width}x${md.height}`;
  } catch {
    // fall through
  }
  return null;
}

async function main() {
  const args = parseArgs();
  const client = await getActiveClient();

  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`Source:        ${SOURCE_DIR}`);
  console.log(`Dry-run:       ${args.dryRun}${args.limit ? `  limit=${args.limit}` : ""}\n`);

  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name !== ".DS_Store")
    .map((e) => e.name)
    .sort();
  const skippedDirs = entries.filter((e) => e.isDirectory()).length;
  console.log(`Found ${files.length} files (${skippedDirs} directories skipped)\n`);

  const existingRows = await db
    .select({ fileName: creatives.fileName })
    .from(creatives)
    .where(eq(creatives.clientId, client.id));
  const existing = new Set(existingRows.map((r) => r.fileName));
  console.log(`Already in library: ${existing.size} file names\n`);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedUnparseable = 0;
  let dimMismatch = 0;
  const errors: string[] = [];

  let n = 0;
  for (const filename of files) {
    if (args.limit !== null && inserted >= args.limit) break;
    n++;

    if (existing.has(filename)) {
      skippedExisting++;
      continue;
    }

    const parsed = parseCreativeFilename(filename);
    if (!parsed.brand || !parsed.type) {
      skippedUnparseable++;
      console.log(`  ⚠ unparseable (brand=${parsed.brand}, type=${parsed.type}): ${filename}`);
      continue;
    }

    try {
      const abs = path.join(SOURCE_DIR, filename);
      const buffer = await fs.readFile(abs);
      const stat = await fs.stat(abs);
      const mtime = toUtcTimestamp(stat.mtime);
      const mime = MIME[parsed.ext] ?? "application/octet-stream";

      const actual = parsed.type === "image" ? await actualImageDimensions(buffer) : null;
      const finalDims = actual ?? parsed.declaredDimensions ?? null;
      if (actual && parsed.declaredDimensions && actual !== parsed.declaredDimensions) {
        dimMismatch++;
        console.log(`  ⚠ dim mismatch: ${filename} — declared ${parsed.declaredDimensions}, actual ${actual}`);
      }

      if (args.dryRun) {
        inserted++;
        if (inserted <= 5) {
          console.log(`  [dry] ${filename}`);
          console.log(`        product=${parsed.product} mc=${parsed.mcNumber ?? "-"}${parsed.mcVariant ?? ""} v=${parsed.version} type=${parsed.type} dims=${finalDims} mtime=${mtime}`);
        }
        continue;
      }

      const uploaded = await uploadFile(client.id, {
        buffer,
        originalFilename: filename,
        mimeType: mime,
        category: "creative",
        uploadedBy: "import-codex-creatives",
        dimensions: finalDims ?? undefined,
      });

      await db.insert(creatives).values({
        clientId: client.id,
        brand: parsed.brand,
        product: parsed.product,
        type: parsed.type,
        visualKeyword: parsed.keywords || null,
        mcNumber: parsed.mcNumber,
        mcVariant: parsed.mcVariant,
        bannerVersion: parsed.version > 1 ? `n${parsed.version}` : null,
        fileId: uploaded.id,
        fileName: filename,
        fileFormat: parsed.ext,
        fileSize: String(buffer.byteLength),
        fileDimensions: finalDims,
        familyKey: parsed.familyKey,
        version: parsed.version,
        createdAt: mtime,
        updatedAt: mtime,
      });
      inserted++;
      if (inserted % 100 === 0) console.log(`  … ${inserted} inserted (${n}/${files.length} scanned)`);
    } catch (e) {
      errors.push(`${filename}: ${(e as Error).message}`);
    }
  }

  console.log(`\n=== Import ${args.dryRun ? "(DRY RUN)" : "complete"} ===`);
  console.log(`  inserted             ${inserted}`);
  console.log(`  skipped (existing)   ${skippedExisting}`);
  console.log(`  skipped (unparseable)${skippedUnparseable}`);
  console.log(`  dim mismatches       ${dimMismatch}`);
  if (errors.length) {
    console.log(`  errors               ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`    · ${e}`);
  }

  await getClient().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
