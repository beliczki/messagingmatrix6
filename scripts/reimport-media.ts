// Wipe image creatives + all assets for the active client and re-run only the
// creatives (filtered to type='image') and assets sheets from the XLSX. Video
// creatives are left alone. After this, run `npm run link:erste` to attach
// files (which will set `created_at` / `updated_at` from each file's mtime).
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/reimport-media.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/reimport-media.ts --xlsx <path>
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/reimport-media.ts --dry-run

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import xlsx from "node-xlsx";
import { and, eq } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { assets, creatives } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import {
  emptyCounts,
  importAssets,
  importCreatives,
} from "../src/lib/import-xlsx";

const DEFAULT_XLSX = path.resolve(
  process.cwd(),
  "docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx",
);

function parseArgs() {
  const argv = process.argv.slice(2);
  let xlsxPath = DEFAULT_XLSX;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--xlsx") {
      xlsxPath = path.resolve(process.cwd(), argv[++i]!);
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/reimport-media.ts [--xlsx <path>] [--dry-run]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { xlsxPath, dryRun };
}

type Sheet = { name: string; data: unknown[][] };

function main() {
  const { xlsxPath, dryRun } = parseArgs();
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`XLSX: ${xlsxPath}`);
  console.log(`Dry-run: ${dryRun}`);

  const beforeImageCreatives = db
    .select()
    .from(creatives)
    .where(and(eq(creatives.clientId, client.id), eq(creatives.type, "image")))
    .all().length;
  const beforeAssets = db
    .select()
    .from(assets)
    .where(eq(assets.clientId, client.id))
    .all().length;
  console.log(
    `Before: image creatives = ${beforeImageCreatives} · assets = ${beforeAssets}`,
  );

  const sheets = xlsx.parse(xlsxPath, { raw: true }) as Sheet[];
  const byName = new Map<string, unknown[][]>(sheets.map((s) => [s.name, s.data]));
  const inserted = emptyCounts();
  const skipped = emptyCounts();
  const errors: string[] = [];

  const work = () => {
    db.delete(assets).where(eq(assets.clientId, client.id)).run();
    db.delete(creatives)
      .where(and(eq(creatives.clientId, client.id), eq(creatives.type, "image")))
      .run();
    importCreatives(
      byName.get("creatives"),
      client.id,
      inserted,
      skipped,
      errors,
      { typeFilter: "image" },
    );
    importAssets(byName.get("assets"), client.id, inserted, skipped, errors);
  };

  if (dryRun) {
    try {
      db.transaction((_tx) => {
        work();
        throw new RollbackForDryRun();
      });
    } catch (e) {
      if (!(e instanceof RollbackForDryRun)) throw e;
    }
  } else {
    work();
  }

  console.log(`\n=== Re-import ${dryRun ? "(DRY RUN)" : "complete"} ===`);
  console.log(`  creatives (image)  inserted=${inserted.creatives} skipped=${skipped.creatives}`);
  console.log(`  assets             inserted=${inserted.assets}    skipped=${skipped.assets}`);
  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors.slice(0, 10)) console.log(`  · ${e}`);
  }
  if (!dryRun) {
    console.log("\nNext step: ACTIVE_CLIENT_KEY=erste npx tsx scripts/link-creative-files.ts");
  }
  getSqlite().close();
}

class RollbackForDryRun extends Error {
  constructor() {
    super("dry-run rollback");
  }
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
