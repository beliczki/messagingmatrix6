import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitoring } from "@/db/schema";
import { periodDateKey } from "@/lib/period";

export type MessageMetricRow = {
  messageId: number;
  impressions: number;
  cost: number;
  conversions: number;
};

export type MessageMetrics = {
  /** Report periods, newest first. `periodFrom` is the addressable key. */
  periods: Array<{ periodFrom: string; periodTo: string }>;
  /** The period these rows cover. */
  period: string | null;
  rows: MessageMetricRow[];
  /**
   * What share of each metric in this period could be tied to a matrix message
   * at all. The sankey can only draw the matched part, so it has to say how big
   * that part is — a diagram that silently shows 13% of the spend is worse than
   * no diagram.
   */
  coverage: {
    impressions: { total: number; matched: number };
    cost: { total: number; matched: number };
    conversions: { total: number; matched: number };
  };
};

/**
 * Per-message delivery for one report period.
 *
 * Unlike `dashboard-monitoring.ts` this does NOT drop `impressions = 0` rows.
 * There they are the 1x1 click trackers that would wreck CTR; here dropping
 * them would delete most of the spend (Aug 2026: 62% of cost sits on
 * zero-impression rows). They contribute nothing to an impression weighting
 * either way, so one query serves both metrics honestly.
 *
 * Row count is bounded by the number of distinct matched messages — one row per
 * message, not per monitoring row — so it stays in the low thousands and needs
 * no paging. (`postgres.js` has no PostgREST-style 1000-row cap; the bound is
 * stated here so a future reader does not have to re-derive it.)
 */
export async function messageMetrics(
  clientId: number,
  requestedPeriod?: string,
): Promise<MessageMetrics> {
  const periodRows = await db
    .select({
      periodFrom: monitoring.periodFrom,
      periodTo: monitoring.periodTo,
    })
    .from(monitoring)
    .where(eq(monitoring.clientId, clientId))
    .groupBy(monitoring.periodFrom, monitoring.periodTo);

  // Ordered on the parsed date, not the stored text: `period_from` is
  // "DD/MM/YYYY", so "01/12/2025" sorts after "01/05/2026" as a string.
  periodRows.sort((a, b) =>
    (periodDateKey(b.periodFrom) ?? "").localeCompare(
      periodDateKey(a.periodFrom) ?? "",
    ),
  );

  const period =
    requestedPeriod && periodRows.some((p) => p.periodFrom === requestedPeriod)
      ? requestedPeriod
      : (periodRows[0]?.periodFrom ?? null);

  if (period === null) {
    return {
      periods: periodRows,
      period: null,
      rows: [],
      coverage: {
        impressions: { total: 0, matched: 0 },
        cost: { total: 0, matched: 0 },
        conversions: { total: 0, matched: 0 },
      },
    };
  }

  const scope = and(
    eq(monitoring.clientId, clientId),
    eq(monitoring.periodFrom, period),
  );

  // ::float8 so postgres-js returns JS numbers rather than bigint strings.
  const [totals] = await db
    .select({
      impressions: sql<number>`coalesce(sum(${monitoring.impressions}), 0)::float8`,
      cost: sql<number>`coalesce(sum(${monitoring.cost}), 0)::float8`,
      conversions: sql<number>`coalesce(sum(${monitoring.conversions}), 0)::float8`,
      matchedImpressions: sql<number>`coalesce(sum(case when ${monitoring.messageId} is not null then ${monitoring.impressions} else 0 end), 0)::float8`,
      matchedCost: sql<number>`coalesce(sum(case when ${monitoring.messageId} is not null then ${monitoring.cost} else 0 end), 0)::float8`,
      matchedConversions: sql<number>`coalesce(sum(case when ${monitoring.messageId} is not null then ${monitoring.conversions} else 0 end), 0)::float8`,
    })
    .from(monitoring)
    .where(scope);

  const rows = await db
    .select({
      messageId: sql<number>`${monitoring.messageId}::int`,
      impressions: sql<number>`coalesce(sum(${monitoring.impressions}), 0)::float8`,
      cost: sql<number>`coalesce(sum(${monitoring.cost}), 0)::float8`,
      conversions: sql<number>`coalesce(sum(${monitoring.conversions}), 0)::float8`,
    })
    .from(monitoring)
    .where(and(scope, sql`${monitoring.messageId} is not null`))
    .groupBy(monitoring.messageId);

  return {
    periods: periodRows,
    period,
    rows,
    coverage: {
      impressions: {
        total: totals?.impressions ?? 0,
        matched: totals?.matchedImpressions ?? 0,
      },
      cost: { total: totals?.cost ?? 0, matched: totals?.matchedCost ?? 0 },
      conversions: {
        total: totals?.conversions ?? 0,
        matched: totals?.matchedConversions ?? 0,
      },
    },
  };
}
