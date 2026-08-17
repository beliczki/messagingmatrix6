// One-time data migration (ships with schema migration 0007): move the legacy
// `audiences.channel != null` rows into the new `channels` table, then delete
// them from audiences so the audiences list is DCO-only. nonDCO messages keep
// their `audience = "ch_disp"` key and resolve through the channels table.
// Also ensures the 6 canonical channels exist (fresh clients). Idempotent.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/migrate-channels.ts
//
// Run in the SAME deploy pass as `npm run db:migrate` + pm2 restart — the code
// that reads channels ships together with this data move.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { getActiveClient } from "../src/lib/active-client";
import {
  createChannel,
  listChannels,
  migrateChannelsFromAudiences,
} from "../src/lib/entities/channels";

const CANONICAL: Array<{ code: string; label: string }> = [
  { code: "DISP", label: "Display" },
  { code: "SOC", label: "Social" },
  { code: "PRG", label: "Programmatic" },
  { code: "GSN", label: "Google Search" },
  { code: "GNW", label: "Google Network" },
  { code: "YT", label: "YouTube" },
];

async function main() {
  const client = await getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);

  const res = await migrateChannelsFromAudiences(client.id);
  console.log(
    `Migrated channel-audiences → channels: seeded ${res.seeded}, deleted ${res.deleted} audience rows.`,
  );

  const have = new Set((await listChannels(client.id, { includeArchived: true })).map((c) => c.code));
  let added = 0;
  for (const c of CANONICAL) {
    if (have.has(c.code)) continue;
    const row = await createChannel(client.id, {
      key: `ch_${c.code.toLowerCase()}`,
      code: c.code,
      label: c.label,
    });
    console.log(`  ✓ ${c.code} — created canonical channel (key=${row.key})`);
    added++;
  }
  console.log(`\nDone. Canonical channels added: ${added}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
