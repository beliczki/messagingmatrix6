import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, config, type Client } from "@/db/schema";
import { defaultConfigSeed } from "@/db/defaults";

// Spec §17.6 — resolve which client this deploy serves.
// ACTIVE_CLIENT_KEY is read once at boot. If the row doesn't exist, it is
// auto-created with default config so a fresh deploy doesn't crash on first
// login.

let cached: Client | null = null;

function readEnvKey(): string {
  const k = process.env.ACTIVE_CLIENT_KEY?.trim();
  if (!k) {
    throw new Error(
      "ACTIVE_CLIENT_KEY is not set. Each deploy is locked to one client; " +
        "set ACTIVE_CLIENT_KEY=<key> in .env (e.g. erste, telekom, proficio).",
    );
  }
  return k;
}

function seedDefaultsForClient(clientId: number) {
  const rows = defaultConfigSeed().map((r) => ({
    clientId,
    key: r.key,
    category: r.category,
    value: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
  }));
  if (rows.length === 0) return;
  db.insert(config).values(rows).run();
}

export function getActiveClient(): Client {
  if (cached) return cached;
  const key = readEnvKey();

  const existing = db.select().from(clients).where(eq(clients.key, key)).get();
  if (existing) {
    cached = existing;
    return existing;
  }

  // Auto-create on first boot (Spec §17.2 / §17.6).
  const inserted = db
    .insert(clients)
    .values({ key, name: key.charAt(0).toUpperCase() + key.slice(1) })
    .returning()
    .get();
  seedDefaultsForClient(inserted.id);
  cached = inserted;
  return inserted;
}

export function activeClientId(): number {
  return getActiveClient().id;
}

// Test-only: clear the cached singleton between integration tests.
export function _resetActiveClientCacheForTests() {
  cached = null;
}
