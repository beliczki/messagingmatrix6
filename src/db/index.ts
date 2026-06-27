import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Drizzled = ReturnType<typeof drizzle<typeof schema>>;
type Client = ReturnType<typeof postgres>;

let _client: Client | null = null;
let _db: Drizzled | null = null;

// Active transaction handle for the current async context. When set (inside a
// `db.transaction(...)` callback), every query issued through the `db` proxy is
// routed through this transaction instead of the root pool connection. This is
// what keeps entity functions — which import the module-global `db` — part of
// an enclosing transaction. Under better-sqlite3 that was automatic (sync, one
// connection); Postgres runs the transaction on its own pooled connection, so
// without this the global `db` would escape the transaction and break atomicity.
const txStore = new AsyncLocalStorage<unknown>();

function resolveUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "postgres://postgres:mm6dev@localhost:55432/mm6";
  return url;
}

function init(url: string) {
  if (_client) void _client.end();
  // prepare: false keeps us compatible with Supabase's transaction-mode pooler
  // (Supavisor / pgBouncer), which does not support prepared statements.
  _client = postgres(url, { max: 10, prepare: false });
  _db = drizzle(_client, { schema });
}

function ensureInit() {
  if (_db) return;
  init(resolveUrl());
}

// Proxy so module consumers can `import { db }` and (a) always see the latest
// connection after `_resetDbForTests`, and (b) transparently participate in an
// ambient transaction set up by a `db.transaction(...)` higher in the call stack.
export const db = new Proxy({} as Drizzled, {
  get(_target, prop, receiver) {
    ensureInit();
    const active = txStore.getStore() as Drizzled | undefined;
    const target = (active ?? _db) as object;

    if (prop === "transaction") {
      // Wrap the callback so its transaction handle becomes the ambient one for
      // every query issued (directly or via entity functions) inside it.
      const tx = (target as Drizzled).transaction.bind(target as Drizzled);
      return (
        fn: (h: unknown) => Promise<unknown>,
        ...rest: unknown[]
      ) =>
        // @ts-expect-error — drizzle's transaction config overloads
        tx((inner: unknown) => txStore.run(inner, () => fn(inner)), ...rest);
    }

    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export function getClient(): Client {
  ensureInit();
  return _client as Client;
}

// Test-only: re-open the DB at the given connection URL.
export function _resetDbForTests(url: string) {
  init(url);
}

// Test-only: close the active connection pool.
export async function _closeDbForTests() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}
