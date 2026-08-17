// DEPRECATED (2026-08-17). Channels are no longer audience rows — they live in
// the `channels` table. Seeding channel-audiences would re-dirty the audiences
// list. Use scripts/migrate-channels.ts instead (moves legacy channel-audiences
// into the channels table AND seeds the canonical 6 channels, idempotently).

console.error(
  "seed-channel-audiences.ts is deprecated — channels moved to their own table.\n" +
    "Run instead:  ACTIVE_CLIENT_KEY=<key> npx tsx scripts/migrate-channels.ts",
);
process.exit(1);
