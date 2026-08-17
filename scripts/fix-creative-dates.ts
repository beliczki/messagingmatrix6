// Backfill creatives.createdAt from the real file date instead of the import
// timestamp. Primary source: the export CSV's `date` column (matched by
// suggested_filename → creatives.fileName). Fallback: the local file's mtime.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=... npx tsx scripts/fix-creative-dates.ts
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=... npx tsx scripts/fix-creative-dates.ts --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { creatives } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";

const BASE = "/Users/robertbeliczki/ERSTE Addressable AI Agent";
const CSV = path.join(BASE, "static_creatives_export.csv");
const SRC_DIR = path.join(BASE, "creatives");

// "2025-08-27T11:32:10+02:00" | Date → "YYYY-MM-DD HH:MM:SS" (wall clock kept).
function fmtIso(iso: string): string | null {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : null;
}
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// CSV: only cols 2 (date) and 9 (suggested_filename) are needed; both precede
// the free-text `comment` col, so a plain split on "," is safe for them.
function loadCsvDates(): Map<string, string> {
  const lines = fs.readFileSync(CSV, "utf8").split("\n");
  const out = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(",");
    const date = c[1]?.trim();
    const suggested = c[8]?.trim();
    if (!date || !suggested) continue;
    const f = fmtIso(date);
    if (f && !out.has(suggested)) out.set(suggested, f);
  }
  return out;
}

function localMtime(fileName: string): string | null {
  try {
    return fmtDate(fs.statSync(path.join(SRC_DIR, fileName)).mtime);
  } catch {
    return null;
  }
}

async function main() {
  const commit = process.argv.includes("--commit");
  const client = await getActiveClient();
  const clientId = client.id;
  const csv = loadCsvDates();
  console.log(`CSV suggested_filename→date entries: ${csv.size}`);

  const rows = await db
    .select({ id: creatives.id, fileName: creatives.fileName, createdAt: creatives.createdAt })
    .from(creatives)
    .where(eq(creatives.clientId, clientId));
  console.log(`creatives rows: ${rows.length}`);

  let fromCsv = 0,
    fromMtime = 0,
    unresolved = 0;
  const plan: { id: number; date: string }[] = [];
  for (const r of rows) {
    if (!r.fileName) {
      unresolved++;
      continue;
    }
    const csvDate = csv.get(r.fileName);
    const date = csvDate ?? localMtime(r.fileName);
    if (!date) {
      unresolved++;
      continue;
    }
    if (csvDate) fromCsv++;
    else fromMtime++;
    plan.push({ id: r.id, date });
  }
  console.log(`resolved: ${plan.length} (CSV ${fromCsv}, mtime ${fromMtime}), unresolved ${unresolved}`);
  console.log("sample:");
  for (const p of plan.slice(0, 6)) {
    const r = rows.find((x) => x.id === p.id)!;
    console.log(`  ${r.fileName} : ${r.createdAt} → ${p.date}`);
  }

  if (!commit) {
    console.log("\nDRY-RUN — nothing written.");
    process.exit(0);
  }
  // Bulk update in chunks — one UPDATE ... FROM (VALUES ...) per chunk keeps it
  // to a handful of round-trips instead of 3000+ over the tunnel.
  const CHUNK = 500;
  for (let i = 0; i < plan.length; i += CHUNK) {
    const chunk = plan.slice(i, i + CHUNK);
    const values = chunk.map((p) => `(${p.id}, '${p.date}')`).join(",");
    await db.execute(
      sql.raw(
        `update creatives as c set created_at = v.d from (values ${values}) as v(id, d) where c.id = v.id and c.client_id = ${clientId}`,
      ),
    );
    console.log(`  updated ${Math.min(i + CHUNK, plan.length)}/${plan.length}`);
  }
  console.log(`Updated ${plan.length} creatives.createdAt`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
