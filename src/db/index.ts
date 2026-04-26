import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "./schema";

type Drizzled = ReturnType<typeof drizzle<typeof schema>>;

let _sqlite: Database.Database | null = null;
let _db: Drizzled | null = null;

function resolvePath(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return path.resolve(process.cwd(), "db", "matrix.db");
  return url.replace(/^file:/, "");
}

function init(dbPath: string) {
  if (_sqlite) _sqlite.close();
  _sqlite = new Database(dbPath);
  _sqlite.pragma("journal_mode = WAL");
  _sqlite.pragma("foreign_keys = ON");
  _sqlite.pragma("busy_timeout = 5000");
  _db = drizzle(_sqlite, { schema });
}

function ensureInit() {
  if (_db) return;
  init(resolvePath());
}

// Proxy so module consumers can do `import { db } from "@/db"` and still see
// the latest connection after `_resetDbForTests` swaps it.
export const db = new Proxy({} as Drizzled, {
  get(_target, prop, receiver) {
    ensureInit();
    return Reflect.get(_db as object, prop, receiver);
  },
});

export function getSqlite(): Database.Database {
  ensureInit();
  return _sqlite as Database.Database;
}

// Test-only: re-open the DB at the given path. Tests call this with a fresh
// temp file in beforeEach.
export function _resetDbForTests(dbPath: string) {
  init(dbPath);
}
