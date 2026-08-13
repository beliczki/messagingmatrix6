// Seeds the 6 nonDCO channel audiences for the active client — the columns of
// the nonDCO matrix view. Idempotent: skips any channel that already exists
// (matched on `audiences.channel`). Touches nothing else. Safe on a live deploy.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/seed-channel-audiences.ts
//
// The channel set is fixed (prodlist channels). DISP/SOC/PRG carry static image
// creatives in practice; GSN (Text) / GNW (Special) / YT (video) are seeded for
// completeness so every prodlist channel has a home.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db";
import { audiences } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { createAudience } from "../src/lib/entities/audiences";

const CHANNELS: Array<{ channel: string; name: string }> = [
  { channel: "DISP", name: "Display" },
  { channel: "SOC", name: "Social" },
  { channel: "PRG", name: "Programmatic" },
  { channel: "GSN", name: "Google Search" },
  { channel: "GNW", name: "Google Network" },
  { channel: "YT", name: "YouTube" },
];

async function main() {
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);

  const existing = await db
    .select({ channel: audiences.channel })
    .from(audiences)
    .where(
      and(eq(audiences.clientId, client.id), isNotNull(audiences.channel)),
    );
  const have = new Set(existing.map((r) => r.channel));

  let created = 0;
  for (const c of CHANNELS) {
    if (have.has(c.channel)) {
      console.log(`  · ${c.channel} — already present, skipped`);
      continue;
    }
    const row = await createAudience(client.id, {
      key: `ch_${c.channel.toLowerCase()}`,
      name: c.name,
      channel: c.channel,
    });
    console.log(`  ✓ ${c.channel} — created (key=${row.key}, id=${row.id})`);
    created++;
  }

  console.log(`\nDone. Created ${created}, skipped ${CHANNELS.length - created}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
