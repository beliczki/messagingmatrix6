import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitoring } from "@/db/schema";
import { periodDateKey } from "@/lib/period";

export type DeliveryMonth = {
  periodFrom: string;
  periodTo: string;
  impressions: number;
  clicks: number;
  cost: number;
  /** Impressions on rows the importer could link to a matrix message. */
  matchedImpressions: number;
};

/**
 * Delivery per report period, newest last — the series behind the dashboard's
 * trend and coverage tiles.
 *
 * Two things this deliberately does NOT inherit from the rest of the page:
 *
 * - **It ignores the day scope.** `monitoring` holds whole report periods
 *   (months, straight from the platform XLSX), so a Today/Yesterday window
 *   would render empty every day of the month but one. The tiles label their
 *   own period instead.
 * - **It drops `impressions = 0` rows.** Those are the `1x1` click trackers:
 *   in August they carry 445k clicks and 17.9M in cost against zero
 *   impressions, which makes CTR meaningless and double-counts the spend
 *   already reported on the banner rows.
 *
 * No pagination needed: the group is one row per report period, i.e. twelve a
 * year for a monthly ingest — three orders of magnitude below the row cap.
 */
export async function monthlyDelivery(
  clientId: number,
  n = 6,
): Promise<DeliveryMonth[]> {
  const rows = await db
    .select({
      periodFrom: monitoring.periodFrom,
      periodTo: monitoring.periodTo,
      // ::float8 so postgres-js returns JS numbers rather than bigint strings.
      impressions: sql<number>`sum(${monitoring.impressions})::float8`,
      clicks: sql<number>`sum(${monitoring.clicks})::float8`,
      cost: sql<number>`sum(${monitoring.cost})::float8`,
      matchedImpressions: sql<number>`sum(case when ${monitoring.messageId} is not null then ${monitoring.impressions} else 0 end)::float8`,
    })
    .from(monitoring)
    .where(
      and(eq(monitoring.clientId, clientId), gt(monitoring.impressions, 0)),
    )
    .groupBy(monitoring.periodFrom, monitoring.periodTo);

  // Ordered on the parsed date, never on the stored text: `period_from` is
  // "DD/MM/YYYY", so "01/12/2025" sorts after "01/05/2026" and the trend would
  // read backwards across a year end.
  return rows
    .sort((a, b) =>
      (periodDateKey(a.periodFrom) ?? "").localeCompare(
        periodDateKey(b.periodFrom) ?? "",
      ),
    )
    .slice(-n);
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "01/08/2026 00:00:00" -> "Aug 2026" (or "Aug" when only the axis tick is
 * wanted). Falls back to the raw day when the period is not parseable, so an
 * odd import shows itself rather than rendering a wrong month.
 */
export function monthLabel(periodFrom: string, short = false): string {
  const key = periodDateKey(periodFrom);
  if (!key) return periodFrom.split(" ")[0];
  const [year, month] = key.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return short ? name : `${name} ${year}`;
}

/** 20051365 -> "20.1M". Tile values have room for four characters, not eight. */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}
