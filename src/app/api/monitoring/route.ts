import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitoring, messages as messagesTable } from "@/db/schema";
import { periodDateKey } from "@/lib/period";
import { withSession } from "@/lib/scoped";

// GET /api/monitoring — read back imported monitoring data for the active
// client. Returns the list of report periods (newest first) plus the rows for
// the SELECTED RANGE of periods, each left-joined to its matrix message for
// name/status.
//
// The range is a contiguous slice of the period list, addressed by the two
// `period_from` markers `?from=` and `?to=` (both inclusive, defaulting to the
// newest period alone). Rows are summed across the slice on the message key, so
// widening the range does not multiply the payload: the four periods live today
// are 15,646 stored rows but only 6,227 distinct keys — about the size of the
// single busiest period on its own.
//
// The grain is whatever period the report was pulled for, which today is a
// month: `monitoring` has no day dimension (the source XLSX reports the whole
// period at once), so no slice narrower than a period is answerable.

export const GET = withSession(async ({ req, claims }) => {
  const periods = await db
    .select({
      periodFrom: monitoring.periodFrom,
      periodTo: monitoring.periodTo,
      // ::int / ::float8 so postgres-js returns JS numbers, not bigint strings.
      rows: sql<number>`count(*)::int`,
      impressions: sql<number>`coalesce(sum(${monitoring.impressions}), 0)::float8`,
    })
    .from(monitoring)
    .where(eq(monitoring.clientId, claims.cid))
    .groupBy(monitoring.periodFrom, monitoring.periodTo);

  // Newest first, ordered on the parsed date rather than the stored text:
  // `period_from` is "DD/MM/YYYY", so "01/12/2025" sorts after "01/05/2026" and
  // the selector would list a year end out of order.
  periods.sort((a, b) =>
    (periodDateKey(b.periodFrom) ?? "").localeCompare(
      periodDateKey(a.periodFrom) ?? "",
    ),
  );

  if (periods.length === 0) {
    return NextResponse.json({
      periods: [],
      selected: null,
      rows: [],
      mcTrend: [],
    });
  }

  // Either marker may be missing or unknown; each falls back to the newest
  // period, which reproduces the single-period default this route had before.
  const indexOf = (value: string | null) => {
    if (!value) return 0;
    const i = periods.findIndex((p) => p.periodFrom === value);
    return i === -1 ? 0 : i;
  };
  const a = indexOf(req.nextUrl.searchParams.get("from"));
  const b = indexOf(req.nextUrl.searchParams.get("to"));
  const slice = periods.slice(Math.min(a, b), Math.max(a, b) + 1);
  const sliceFroms = slice.map((p) => p.periodFrom);
  const oldest = slice[slice.length - 1];
  const newest = slice[0];

  const inSlice = and(
    eq(monitoring.clientId, claims.cid),
    inArray(monitoring.periodFrom, sliceFroms),
  );

  // One row per (platform, message key, size) for the whole slice. `product`,
  // `message_id` and `match_level` are grouped rather than folded with a
  // max(): measured on live data, no key carries two different values for them
  // across periods, and if one ever does it should show as two rows rather
  // than be resolved away silently. The message columns are grouped too —
  // they hang off `monitoring.message_id`, not off `messages.id`, so Postgres
  // cannot infer the functional dependency.
  const rows = await db
    .select({
      id: sql<number>`min(${monitoring.id})::int`,
      platform: monitoring.platform,
      product: monitoring.product,
      size: monitoring.size,
      pmmid: sql<string | null>`min(${monitoring.pmmid})`,
      messageId: monitoring.messageId,
      matchLevel: monitoring.matchLevel,
      audienceKey: monitoring.audienceKey,
      topicKey: monitoring.topicKey,
      mcNumber: monitoring.mcNumber,
      mcVariant: monitoring.mcVariant,
      impressions: sql<number>`sum(${monitoring.impressions})::int`,
      clicks: sql<number>`sum(${monitoring.clicks})::int`,
      cost: sql<number>`sum(${monitoring.cost})::float8`,
      conversions: sql<number>`sum(${monitoring.conversions})::int`,
      messageName: messagesTable.name,
      messageStatus: messagesTable.status,
    })
    .from(monitoring)
    .leftJoin(messagesTable, eq(monitoring.messageId, messagesTable.id))
    .where(inSlice)
    .groupBy(
      monitoring.platform,
      monitoring.product,
      monitoring.size,
      monitoring.messageId,
      monitoring.matchLevel,
      monitoring.audienceKey,
      monitoring.topicKey,
      monitoring.mcNumber,
      monitoring.mcVariant,
      messagesTable.name,
      messagesTable.status,
    )
    .orderBy(desc(sql`sum(${monitoring.impressions})`));

  // Per-MC, per-period totals — the detail dialog's month-by-month breakdown.
  // Bounded by distinct MCs x periods (267 x 4 today), so it stays small even
  // when the whole history is selected.
  const mcTrend = await db
    .select({
      mcNumber: monitoring.mcNumber,
      mcVariant: monitoring.mcVariant,
      periodFrom: monitoring.periodFrom,
      impressions: sql<number>`sum(${monitoring.impressions})::int`,
      clicks: sql<number>`sum(${monitoring.clicks})::int`,
    })
    .from(monitoring)
    .where(inSlice)
    .groupBy(monitoring.mcNumber, monitoring.mcVariant, monitoring.periodFrom);

  return NextResponse.json({
    periods,
    selected: {
      // The two markers the selects are bound to, newest-first like the list.
      from: newest.periodFrom,
      to: oldest.periodFrom,
      // The span they cover, for display.
      periodFrom: oldest.periodFrom,
      periodTo: newest.periodTo,
      periods: slice.length,
    },
    // CTR is recomputed from the summed clicks and impressions — averaging the
    // stored per-period CTRs would weight a quiet month like a busy one.
    rows: rows.map((r) => ({
      ...r,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
    })),
    mcTrend,
  });
});
