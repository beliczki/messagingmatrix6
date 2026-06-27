// One-off: copy all data from the local SQLite matrix.db into the shared
// Hetzner Postgres (reached via the SSH tunnel on localhost:5433).
//
//   PG_URL=postgres://postgres:<pw>@localhost:5433/mm6 \
//     node scripts/backfill-to-pg.mjs [path-to-sqlite-db]
//
// Idempotent: TRUNCATE … RESTART IDENTITY CASCADE before loading, preserves
// original ids + created_at/updated_at, resets identity sequences afterward.
import Database from "better-sqlite3";
import postgres from "postgres";

const SQLITE_PATH = process.argv[2] ?? "db/matrix.db";
const PG_URL = process.env.PG_URL;
if (!PG_URL) {
  console.error("PG_URL env var is required");
  process.exit(1);
}

// FK-safe insert order: parents before children.
const ORDER = [
  "clients",
  "system_config",
  "users",
  "audit_log",
  "config",
  "audiences",
  "topics",
  "assets",
  "creatives",
  "text_formatting",
  "reporting",
  "uploaded_files",
  "snapshots",
  "feed_exports",
  "keywords",
  "messages",
  "monitoring",
  "share_galleries",
  "share_comments",
];

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const sql = postgres(PG_URL, { prepare: false, onnotice: () => {} });

async function pgColumns(table) {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Set(rows.map((r) => r.column_name));
}

let grandTotal = 0;
try {
  // Wipe target (reverse order) so the load is re-runnable.
  for (const table of [...ORDER].reverse()) {
    await sql.unsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
  }

  for (const table of ORDER) {
    const cols = await pgColumns(table);
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    if (rows.length === 0) {
      console.log(`  ${table}: 0`);
      continue;
    }
    // Keep only columns that exist in the Postgres schema.
    const cleaned = rows.map((r) => {
      const o = {};
      for (const k of Object.keys(r)) if (cols.has(k)) o[k] = r[k];
      return o;
    });
    const CHUNK = 500;
    for (let i = 0; i < cleaned.length; i += CHUNK) {
      const chunk = cleaned.slice(i, i + CHUNK);
      await sql`insert into ${sql(table)} ${sql(chunk)}`;
    }
    // Reset identity sequence (no-op for tables without an id sequence).
    try {
      await sql.unsafe(
        `SELECT setval(pg_get_serial_sequence('${table}','id'),
           GREATEST((SELECT COALESCE(MAX(id),1) FROM "${table}"),1))`,
      );
    } catch {
      /* table has no id sequence — fine */
    }
    grandTotal += rows.length;
    console.log(`  ${table}: ${rows.length}`);
  }
  console.log(`Done. ${grandTotal} rows loaded into Postgres.`);
} finally {
  await sql.end();
  sqlite.close();
}
