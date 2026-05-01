// Synthetic dataset for verifying spec §8.1 perf budgets:
//   - Matrix grid render <50ms for ~30k MCs (100×100 cells × 3 each)
//   - Masonry first paint <200ms for 500 creatives
// Run with: ACTIVE_CLIENT_KEY=erste tsx scripts/seed-perf.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { db } from "../src/db";
import {
  audiences,
  creatives,
  messages,
  topics,
} from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { createSnapshot } from "../src/lib/snapshots";
import { writeAudit } from "../src/lib/audit";

const N_AUDIENCES = 100;
const N_TOPICS = 100;
const MCS_PER_CELL = 3;
const N_CREATIVES = 500;

const PRODUCTS = ["Card", "Loan", "Saving", "Mortgage", "Investment"];
const STRATEGIES = ["Prospecting", "Retargeting", "Retention"];
const DEVICES = ["Desktop", "Mobile", "Tablet"];

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const client = getActiveClient();
  console.log(`Seeding perf dataset for client ${client.key} (id=${client.id})`);

  // Safety net (Phase 10b): auto-snapshot the live state before we wipe the
  // four tables. If someone runs this against production by accident, the
  // Settings → Snapshots tab can roll the deploy back with one click.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snap = createSnapshot(
    client.id,
    `auto-before-perf-seed-${ts}`,
    "seed-perf-script",
  );
  writeAudit({
    clientId: client.id,
    userId: null,
    entityType: "snapshots",
    entityId: snap.id,
    action: "create",
    after: { id: snap.id, label: snap.label, counts: snap.counts },
  });
  console.log(
    `Pre-wipe snapshot saved: id=${snap.id} "${snap.label}" ` +
      `(aud=${snap.counts.audiences}, top=${snap.counts.topics}, ` +
      `mc=${snap.counts.messages}, creative=${snap.counts.creatives})`,
  );
  console.log(
    `If anything goes wrong, restore via Settings → Snapshots in the UI.\n`,
  );

  const sqlite = (await import("../src/db")).getSqlite();
  sqlite.exec("BEGIN");
  try {
    // Wipe what we're about to overwrite.
    db.delete(creatives).where(eqClient(client.id, "creatives")).run();
    db.delete(messages).where(eqClient(client.id, "messages")).run();
    db.delete(topics).where(eqClient(client.id, "topics")).run();
    db.delete(audiences).where(eqClient(client.id, "audiences")).run();

    console.log(`Inserting ${N_AUDIENCES} audiences…`);
    db.insert(audiences)
      .values(
        Array.from({ length: N_AUDIENCES }, (_, i) => ({
          clientId: client.id,
          key: `aud${i + 1}`,
          name: `Audience ${i + 1}`,
          orderIndex: i,
          product: rand(PRODUCTS),
          strategy: rand(STRATEGIES),
          device: rand(DEVICES),
        })),
      )
      .run();

    console.log(`Inserting ${N_TOPICS} topics…`);
    db.insert(topics)
      .values(
        Array.from({ length: N_TOPICS }, (_, i) => ({
          clientId: client.id,
          key: `top${i + 1}`,
          name: `Topic ${i + 1}`,
          orderIndex: i,
          product: rand(PRODUCTS),
        })),
      )
      .run();

    const totalMessages = N_AUDIENCES * N_TOPICS * MCS_PER_CELL;
    console.log(`Inserting ${totalMessages} messages (this can take a few seconds)…`);
    let mcNumber = 0;
    const variants = ["a", "b", "c"];
    const batch: unknown[] = [];
    for (let topIdx = 0; topIdx < N_TOPICS; topIdx++) {
      for (let audIdx = 0; audIdx < N_AUDIENCES; audIdx++) {
        mcNumber++;
        for (let v = 0; v < MCS_PER_CELL; v++) {
          batch.push({
            clientId: client.id,
            number: mcNumber,
            variant: variants[v],
            audience: `aud${audIdx + 1}`,
            topic: `top${topIdx + 1}`,
            versionNo: 1,
            pmmid: `a_aud${audIdx + 1}-t_top${topIdx + 1}-m_${mcNumber}-v_${variants[v]}-n_1`,
            status: rand(["incoming", "preview", "approved", "active"]),
            headline: `MC${mcNumber}${variants[v]} headline`,
          });
        }
        // Flush every 100 rows — better-sqlite3 caps SQL variables around
        // 32k. messages has ~46 columns, so 100 × 46 ≈ 4600 vars per insert.
        if (batch.length >= 100) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          db.insert(messages).values(batch as any).run();
          batch.length = 0;
        }
      }
    }
    if (batch.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.insert(messages).values(batch as any).run();
    }

    console.log(`Inserting ${N_CREATIVES} creatives…`);
    db.insert(creatives)
      .values(
        Array.from({ length: N_CREATIVES }, (_, i) => ({
          clientId: client.id,
          brand: "Erste",
          product: rand(PRODUCTS),
          type: rand(["banner", "video", "static", "card"]),
          template: `template-${rand(["a", "b", "c"])}`,
          fileName: `creative-${i + 1}.png`,
          fileDimensions: rand(["300x250", "300x600", "728x90", "970x250"]),
        })),
      )
      .run();

    sqlite.exec("COMMIT");
    console.log("Seeded.");
    console.log(
      `\nTo verify spec §8.1 budgets, run \`npm run dev\` and:\n` +
        `  - Matrix Grid (/matrix) should paint <50ms — check React DevTools Profiler\n` +
        `  - Creative Library (/creative-library) masonry FCP <200ms — check Lighthouse\n` +
        `  - Message Editor preview re-render <200ms after a field edit\n` +
        `Record findings in tasks/todo.md under "10d review".`,
    );
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
}

import { eq } from "drizzle-orm";
function eqClient(id: number, table: "audiences" | "topics" | "messages" | "creatives") {
  if (table === "audiences") return eq(audiences.clientId, id);
  if (table === "topics") return eq(topics.clientId, id);
  if (table === "messages") return eq(messages.clientId, id);
  return eq(creatives.clientId, id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
