import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { _resetDbForTests, getSqlite } from "@/db";
import { _resetActiveClientCacheForTests } from "@/lib/active-client";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db", "migrations");

function applyMigrations(dbPath: string) {
  const conn = new Database(dbPath);
  conn.pragma("foreign_keys = ON");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    // Drizzle uses `--> statement-breakpoint` between statements.
    const parts = sql
      .split(/-->\s*statement-breakpoint/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    for (const stmt of parts) {
      conn.exec(stmt);
    }
  }
  conn.close();
}

export type TestDb = {
  path: string;
  cleanup: () => void;
};

// Fresh SQLite file per test. Applies all Drizzle migrations.
// Resets the active-client singleton + the db module's connection.
export function createTestDb(): TestDb {
  const dir = mkdtempSync(path.join(tmpdir(), "mm6-test-"));
  const dbPath = path.join(dir, "matrix.db");
  applyMigrations(dbPath);
  _resetDbForTests(dbPath);
  _resetActiveClientCacheForTests();
  return {
    path: dbPath,
    cleanup() {
      try {
        getSqlite().close();
      } catch {
        // already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function withActiveClientKey(key: string) {
  process.env.ACTIVE_CLIENT_KEY = key;
  _resetActiveClientCacheForTests();
}
