// One-off data migration for the status cleanup (12 → 6), 2026-09-05.
//
// DRY RUN BY DEFAULT — pass --apply to write. Same shape as
// scripts/drive-backfill.ts, and for the same reason: this touches production
// rows, two of the four groups irreversibly.
//
// RUN ORDER: migrations 0012 + 0013 FIRST. This script reads columns those
// migrations add (brief_id) and writes states they make legal (DRAFT with a
// NULL audience), so against an unmigrated database it fails on the first
// query rather than doing half the work.
//
// The plan below is not a guess. Every group was inspected on the live Erste
// database first (see tasks/todo.md, "Legacy adat — ELLENŐRIZVE prod DB-n"),
// and the script re-checks each row's shape before touching it: anything that
// does not match what was inspected is reported and SKIPPED, never coerced.
//
//   1. PLANNED, empty, unreferenced  → DELETE   (8 rows: MC21a ×8)
//   2. CONTENT duplicating a live twin → DELETE (4 rows: MC315 f/g/h/i)
//   3. INCOMING with real content     → DRAFT   (4 rows: MC6a, MC78 a/b/c)
//   4. anything else on a dead status → PREVIEW (safety net)
//
// Group 3 drops the audience and the whole trafficking identity: a draft has no
// cell, so a PMMID or a final URL naming one would describe a placement the row
// no longer has. The number, the variant, the topic (now a suggested name) and
// the content all stay.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creatives, messages, monitoring } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import { MC_STATUSES, BIRTH_STATUS } from "@/lib/mc-status";

const APPLY = process.argv.includes("--apply");

const LEGACY_STATUSES = [
  "INCOMING",
  "NAMING",
  "CONTENT",
  "ARCHIVED",
  "ERROR",
  "MEMORY",
  "PLANNED",
];

// A row is "empty" when nothing was ever written into it — the template is the
// code default, so it does not count as content.
function isEmpty(m: typeof messages.$inferSelect): boolean {
  return (
    !m.name?.trim() &&
    !m.headline?.trim() &&
    !m.copy1?.trim() &&
    !m.copy2?.trim() &&
    !m.cta?.trim() &&
    !m.disclaimer?.trim() &&
    !m.image1?.trim()
  );
}

/** Same name AND same lead image as a live sibling under this number = a copy. */
function duplicateOf(
  m: typeof messages.$inferSelect,
  siblings: (typeof messages.$inferSelect)[],
): typeof messages.$inferSelect | undefined {
  return siblings.find(
    (s) =>
      s.id !== m.id &&
      s.status === "ACTIVE" &&
      s.audience === m.audience &&
      s.topic === m.topic &&
      (s.name ?? "") === (m.name ?? "") &&
      (s.image1 ?? "") === (m.image1 ?? ""),
  );
}

async function main() {
  const clientId = await activeClientId();
  const all = await db
    .select()
    .from(messages)
    .where(eq(messages.clientId, clientId));

  const legacy = all.filter((m) => LEGACY_STATUSES.includes(m.status));
  const byStatus = new Map<string, number>();
  for (const m of legacy) {
    byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
  }

  console.log(`client ${clientId}: ${all.length} messages, ${legacy.length} on a retired status`);
  for (const [s, n] of [...byStatus].sort()) console.log(`  ${s}: ${n}`);
  console.log(`target statuses: ${MC_STATUSES.join(", ")}`);
  console.log(APPLY ? "\nAPPLYING\n" : "\nDRY RUN — pass --apply to write\n");

  const toDelete: number[] = [];
  const toDraft: number[] = [];
  const toBirth: number[] = [];

  for (const m of legacy) {
    const label = `MC${m.number}${m.variant} (id ${m.id}, ${m.status})`;

    // 1 + 2: deletable only if nothing downstream points at the number, and
    // only for a row that is provably empty or provably a duplicate.
    const refs = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatives)
      .where(
        and(
          eq(creatives.clientId, clientId),
          eq(creatives.mcNumber, m.number),
          eq(creatives.mcVariant, m.variant),
        ),
      );
    const mon = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(monitoring)
      .where(
        and(
          eq(monitoring.clientId, clientId),
          eq(monitoring.mcNumber, m.number),
          eq(monitoring.mcVariant, m.variant),
        ),
      );
    const referenced = (refs[0]?.n ?? 0) + (mon[0]?.n ?? 0) > 0;

    const siblings = all.filter((s) => s.number === m.number);
    const dup = duplicateOf(m, siblings);

    if (!referenced && isEmpty(m)) {
      console.log(`DELETE  ${label} — empty, no creatives, no monitoring`);
      toDelete.push(m.id);
      continue;
    }
    if (!referenced && dup) {
      console.log(
        `DELETE  ${label} — duplicate of MC${dup.number}${dup.variant} (same name + image, that one is ACTIVE)`,
      );
      toDelete.push(m.id);
      continue;
    }
    if (m.status === "INCOMING" && !isEmpty(m)) {
      // A referenced row still becomes a draft — the creatives keep their
      // (number, variant) link, and the nonDCO twin that actually shipped is a
      // different row on a different axis. Called out because the creative↔cell
      // match will now also see this draft (see D1.4a in tasks/todo.md).
      const note = referenced
        ? ` — NOTE: ${refs[0]?.n ?? 0} creative(s) link to MC${m.number}${m.variant} and will now also match this draft`
        : "";
      console.log(
        `DRAFT   ${label} — real content, unfinished; audience + identity cleared${note}`,
      );
      toDraft.push(m.id);
      continue;
    }
    // Safety net: a retired status on a row that is none of the above keeps its
    // placement and lands on the birth status rather than being guessed at.
    console.log(`${BIRTH_STATUS.padEnd(7)} ${label} — kept in place${referenced ? " (referenced downstream)" : ""}`);
    toBirth.push(m.id);
  }

  console.log(
    `\nplan: delete ${toDelete.length}, to DRAFT ${toDraft.length}, to ${BIRTH_STATUS} ${toBirth.length}`,
  );
  if (!APPLY) return;

  await db.transaction(async (tx) => {
    if (toDelete.length) {
      await tx.delete(messages).where(inArray(messages.id, toDelete));
    }
    if (toDraft.length) {
      await tx
        .update(messages)
        .set({
          status: "DRAFT",
          audience: null,
          // The identity described a cell this row no longer occupies. Promotion
          // regenerates all of it from the cell it actually lands in.
          pmmid: null,
          utmCampaign: null,
          utmSource: null,
          utmMedium: null,
          utmContent: null,
          utmTerm: null,
          utmCd26: null,
          finalTraffickedUrl: null,
        })
        .where(inArray(messages.id, toDraft));
    }
    if (toBirth.length) {
      await tx
        .update(messages)
        .set({ status: BIRTH_STATUS })
        .where(inArray(messages.id, toBirth));
    }
  });

  const left = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        inArray(messages.status, LEGACY_STATUSES),
        isNull(messages.archivedAt),
      ),
    );
  console.log(`done. rows left on a retired status: ${left[0]?.n ?? 0}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
