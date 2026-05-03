// One-shot backfill: re-derive default_label (and default_message_id) for
// every existing AdForm reference snapshot in feed_exports. Use when the
// snapshot upload code starts populating these fields and you want existing
// rows to reflect it without re-uploading.
//
// Usage:  npx tsx scripts/backfill-snapshot-default-labels.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { and, eq } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { feedExports, messages as messagesTable } from "../src/db/schema";
import {
  deserializePayload,
} from "../src/lib/feed-export";
import { extractDefaultMc } from "../src/lib/adform-snapshot";

function main() {
  const snapshots = db
    .select()
    .from(feedExports)
    .where(eq(feedExports.source, "adform_snapshot"))
    .all();

  if (snapshots.length === 0) {
    console.log("No snapshot rows to backfill.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const row of snapshots) {
    const payload = deserializePayload(row.payloadJson);
    if (!payload) {
      console.warn(`#${row.id}: payload won't deserialize — skipping`);
      skipped += 1;
      continue;
    }
    const mc = extractDefaultMc(payload);
    if (!mc) {
      console.warn(`#${row.id}: no DEFAULT row / MC cells — skipping`);
      skipped += 1;
      continue;
    }
    const msg = db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.clientId, row.clientId),
          eq(messagesTable.number, mc.number),
          eq(messagesTable.variant, mc.variant),
        ),
      )
      .get();
    const base = `MC${mc.number}${mc.variant}`;
    const defaultLabel = msg?.name ? `${base} — ${msg.name}` : base;
    const defaultMessageId = msg?.id ?? null;
    db.update(feedExports)
      .set({ defaultLabel, defaultMessageId })
      .where(eq(feedExports.id, row.id))
      .run();
    console.log(
      `#${row.id} (${row.product}): ${defaultLabel}${msg ? ` → message #${msg.id}` : " (not in matrix)"}`,
    );
    updated += 1;
  }

  console.log(`\nBackfilled ${updated} snapshot row${updated === 1 ? "" : "s"}, skipped ${skipped}.`);
  getSqlite().close();
}

main();
