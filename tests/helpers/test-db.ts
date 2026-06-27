import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { _resetDbForTests, _closeDbForTests } from "@/db";
import { _resetActiveClientCacheForTests } from "@/lib/active-client";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db", "migrations");
const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:mm6dev@localhost:55432/mm6_test";

// Migrations are applied once per test process; between tests we only
// TRUNCATE … RESTART IDENTITY (fast, and resets sequences so id-sensitive
// assertions stay stable — the SQLite "fresh file per test" equivalent).
let migrated = false;

async function applyMigrations(sql: postgres.Sql) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const content = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    // Drizzle separates statements with `--> statement-breakpoint`.
    const parts = content
      .split(/-->\s*statement-breakpoint/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const stmt of parts) {
      await sql.unsafe(stmt);
    }
  }
}

async function truncateAll(sql: postgres.Sql) {
  const rows = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export type TestDb = {
  url: string;
  cleanup: () => Promise<void>;
};

// Fresh, isolated DB state per test. Resets the active-client singleton + the
// db module's connection.
export async function createTestDb(): Promise<TestDb> {
  const admin = postgres(TEST_URL, { max: 1, onnotice: () => {} });
  try {
    if (!migrated) {
      await admin.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await applyMigrations(admin);
      migrated = true;
    } else {
      await truncateAll(admin);
    }
  } finally {
    await admin.end();
  }
  _resetDbForTests(TEST_URL);
  _resetActiveClientCacheForTests();
  return {
    url: TEST_URL,
    async cleanup() {
      await _closeDbForTests();
    },
  };
}

export function withActiveClientKey(key: string) {
  process.env.ACTIVE_CLIENT_KEY = key;
  _resetActiveClientCacheForTests();
}
