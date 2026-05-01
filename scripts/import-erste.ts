// Bootstrap the v6 DB with full Erste data from the master XLSX export.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts --xlsx <path>
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts --no-wipe
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts --dry-run
//
// Wipes existing rows for the active client, then imports 7 sheets from the
// xlsx (audiences, topics, messages + AI messages, creatives, assets,
// textformats, Reporting). Skips feed/filtered_feed/keywords/messages_archive.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import { getActiveClient } from "../src/lib/active-client";
import { getSqlite } from "../src/db";
import { importErsteXlsx } from "../src/lib/import-xlsx";

const DEFAULT_XLSX = path.resolve(
  process.cwd(),
  "docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx",
);

function parseArgs() {
  const argv = process.argv.slice(2);
  let xlsx = DEFAULT_XLSX;
  let wipe = true;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--xlsx") {
      xlsx = path.resolve(process.cwd(), argv[++i]);
    } else if (a === "--no-wipe") {
      wipe = false;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts [--xlsx <path>] [--no-wipe] [--dry-run]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { xlsx, wipe, dryRun };
}

function main() {
  const { xlsx, wipe, dryRun } = parseArgs();
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);
  console.log(`XLSX: ${xlsx}`);
  console.log(`Wipe first: ${wipe} · Dry-run: ${dryRun}`);

  const t0 = Date.now();
  const result = importErsteXlsx(xlsx, {
    clientId: client.id,
    wipeFirst: wipe,
    dryRun,
  });
  const ms = Date.now() - t0;

  console.log(`\n=== Import ${dryRun ? "(DRY RUN)" : "complete"} in ${ms}ms ===`);
  console.log("Inserted:");
  for (const [k, v] of Object.entries(result.inserted)) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  const totalSkipped = Object.values(result.skipped).reduce((a, b) => a + b, 0);
  if (totalSkipped > 0) {
    console.log("Skipped (empty / dup key / missing required field):");
    for (const [k, v] of Object.entries(result.skipped)) {
      if (v > 0) console.log(`  ${k.padEnd(18)} ${v}`);
    }
  }
  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const e of result.errors) console.log(`  · ${e}`);
  }
  getSqlite().close();
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
