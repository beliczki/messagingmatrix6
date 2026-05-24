// Seeds the `keywords` table for the active client from the master XLSX's
// `keywords` sheet — **without touching any other table**. Safe to run on a
// live deploy.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/seed-keywords.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/seed-keywords.ts --xlsx <path>
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/seed-keywords.ts --no-wipe
//
// Wipes existing `keywords` rows for the active client (so it's idempotent)
// then re-imports from the XLSX. With `--no-wipe`, leaves existing rows alone
// and additively inserts new ones (UNIQUE-skip on duplicates).

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import xlsx from "node-xlsx";
import { getActiveClient } from "../src/lib/active-client";
import { getSqlite } from "../src/db";
import { emptyCounts, importKeywords } from "../src/lib/import-xlsx";
import { deleteAllKeywordsForClient } from "../src/lib/entities/keywords";

const DEFAULT_XLSX = path.resolve(
  process.cwd(),
  "docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx",
);

type Sheet = { name: string; data: unknown[][] };

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = DEFAULT_XLSX;
  let wipe = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--xlsx") {
      file = path.resolve(process.cwd(), argv[++i]);
    } else if (a === "--no-wipe") {
      wipe = false;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/seed-keywords.ts [--xlsx <path>] [--no-wipe]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { file, wipe };
}

function main() {
  const { file, wipe } = parseArgs();
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`XLSX: ${file}`);
  console.log(`Wipe first: ${wipe}`);

  const sheets = xlsx.parse(file, { raw: true }) as Sheet[];
  const kw = sheets.find((s) => s.name === "keywords");
  if (!kw) {
    console.error("No `keywords` sheet in the XLSX — nothing to do.");
    process.exit(1);
  }

  if (wipe) {
    const removed = deleteAllKeywordsForClient(client.id);
    console.log(`Wiped ${removed} existing keyword rows for ${client.key}.`);
  }

  const inserted = emptyCounts();
  const skipped = emptyCounts();
  const errors: string[] = [];
  const t0 = Date.now();
  importKeywords(kw.data, client.id, inserted, skipped, errors);
  const ms = Date.now() - t0;

  console.log(`\n=== Done in ${ms}ms ===`);
  console.log(`Inserted: ${inserted.keywords} keyword values`);
  console.log(`Skipped:  ${skipped.keywords} (out-of-scope form/field/duplicates)`);
  if (errors.length > 0) {
    console.log("Errors:");
    for (const e of errors) console.log(`  · ${e}`);
  }

  getSqlite().close();
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
