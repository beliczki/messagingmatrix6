// Folder-driven creative re-import. Treats storage/{client}/_inbox-creatives/
// as the source of truth: each file becomes one creatives row, with metadata
// parsed from the filename (brand, product, MC#, variant, keywords, version)
// and the createdAt/updatedAt set to the file's mtime.
//
// Scope: only image creatives are wiped + reinserted. Existing video / non-
// image rows are left alone. Run again any time after dropping new files into
// the inbox.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts --dry-run
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts --include-videos
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts --no-wipe
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts --inbox <path>

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { creatives } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { uploadFile } from "../src/lib/entities/files";
import { parseCreativeFilename } from "../src/lib/parse-creative-filename";

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
  pdf: "application/pdf",
};

type Args = {
  dryRun: boolean;
  wipe: boolean;
  includeVideos: boolean;
  inbox: string | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { dryRun: false, wipe: true, includeVideos: false, inbox: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-wipe") out.wipe = false;
    else if (a === "--include-videos") out.includeVideos = true;
    else if (a === "--inbox") out.inbox = path.resolve(process.cwd(), argv[++i]!);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/scan-creatives.ts [--dry-run] [--no-wipe] [--include-videos] [--inbox <path>]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

async function walkFolder(root: string): Promise<string[]> {
  const out: string[] = [];
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
      out.push(...sub);
    } else if (e.isFile()) {
      out.push(abs);
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
  const client = getActiveClient();
  const inbox = args.inbox ?? path.resolve(
    process.cwd(),
    "storage",
    client.key,
    "_inbox-creatives",
  );

  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`Inbox:         ${inbox}`);
  console.log(`Wipe:          ${args.wipe ? "yes (type=image" + (args.includeVideos ? " + video" : "") + ")" : "no"}`);
  console.log(`Include videos: ${args.includeVideos}`);
  console.log(`Dry-run:       ${args.dryRun}\n`);

  console.log("Indexing inbox…");
  const files = await walkFolder(inbox);
  console.log(`  ${files.length} files found\n`);

  const acceptedTypes = args.includeVideos ? ["image", "video"] : ["image"];

  let inserted = 0;
  let skippedType = 0;
  let skippedNoBrand = 0;
  let dimMismatch = 0;
  const errors: string[] = [];

  const doWork = async () => {
    if (args.wipe && !args.dryRun) {
      const result = db
        .delete(creatives)
        .where(
          and(
            eq(creatives.clientId, client.id),
            inArray(creatives.type, acceptedTypes),
          ),
        )
        .run();
      console.log(`Wiped ${result.changes} existing creatives.\n`);
    } else if (args.wipe) {
      console.log(`(dry-run) would wipe creatives where type IN (${acceptedTypes.join(",")})\n`);
    }

    let n = 0;
    for (const abs of files) {
      n++;
      const filename = path.basename(abs);
      const parsed = parseCreativeFilename(filename);

      if (!parsed.type || !acceptedTypes.includes(parsed.type)) {
        skippedType++;
        continue;
      }
      if (!parsed.brand) {
        skippedNoBrand++;
        continue;
      }

      try {
        const buffer = await fs.readFile(abs);
        const stat = await fs.stat(abs);
        const mtimeIso = stat.mtime.toISOString();
        const mime = MIME[parsed.ext] ?? "application/octet-stream";

        const actual =
          parsed.type === "image" ? await actualImageDimensions(buffer) : null;
        const finalDims = actual ?? parsed.declaredDimensions ?? null;
        if (actual && parsed.declaredDimensions && actual !== parsed.declaredDimensions) {
          dimMismatch++;
          if (dimMismatch <= 10) {
            console.log(
              `  ⚠ dim mismatch: ${filename} — declared ${parsed.declaredDimensions}, actual ${actual}`,
            );
          }
        }

        if (args.dryRun) {
          inserted++;
          if (n <= 5) {
            console.log(`  [dry] ${filename}`);
            console.log(`        product=${parsed.product} mc=${parsed.mcNumber}${parsed.mcVariant ?? ""} v=${parsed.version} dims=${finalDims}`);
            console.log(`        family=${parsed.familyKey}`);
          }
          continue;
        }

        const uploaded = await uploadFile(client.id, {
          buffer,
          originalFilename: filename,
          mimeType: mime,
          category: "creative",
          uploadedBy: "scan-creatives",
          dimensions: finalDims ?? undefined,
        });

        db.insert(creatives)
          .values({
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
            createdAt: mtimeIso,
            updatedAt: mtimeIso,
          })
          .run();
        inserted++;
      } catch (e) {
        errors.push(`${filename}: ${(e as Error).message}`);
      }
    }
  };

  await doWork();

  console.log(`\n=== Scan ${args.dryRun ? "(DRY RUN)" : "complete"} ===`);
  console.log(`  inserted          ${inserted}`);
  console.log(`  skipped (type)    ${skippedType}`);
  console.log(`  skipped (no brand)${skippedNoBrand}`);
  console.log(`  dim mismatches    ${dimMismatch}${dimMismatch > 10 ? " (first 10 listed)" : ""}`);
  if (errors.length) {
    console.log(`  errors            ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`    · ${e}`);
  }
  getSqlite().close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
