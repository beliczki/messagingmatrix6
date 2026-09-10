import { and, eq, gt, inArray, sql } from "drizzle-orm";
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
  /**
   * False for a calendar month `monthlyDelivery` filled in because no report
   * covering it has been imported yet. Zeros on such a month mean "not
   * measured", not "measured as nothing" — the tiles draw the two differently,
   * and neither one may be read as the current month's delivery.
   */
  reported: boolean;
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
 *
 * `throughMonth` ("YYYY-MM", normally the day scope's anchor month) extends the
 * series with the calendar months that have no import yet, flagged
 * `reported: false`. Without it the newest bar is always the newest IMPORT, so
 * a September dashboard presents August as if it were the current month —
 * reporting arrives weeks late, and a missing month has to look missing.
 */
export async function monthlyDelivery(
  clientId: number,
  n = 6,
  products: string[] = [],
  throughMonth?: string,
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
      and(
        eq(monitoring.clientId, clientId),
        gt(monitoring.impressions, 0),
        // A product filter narrows the denominator too: the rows carrying no
        // product at all are the unmatched publisher lines, and they belong to
        // no product by definition. Coverage therefore reads much higher under
        // a filter (Aug 2026: 35% overall, 85% on SZK alone) — a different and
        // equally real question, not an improvement.
        products.length ? inArray(monitoring.product, products) : undefined,
      ),
    )
    .groupBy(monitoring.periodFrom, monitoring.periodTo);

  // Ordered on the parsed date, never on the stored text: `period_from` is
  // "DD/MM/YYYY", so "01/12/2025" sorts after "01/05/2026" and the trend would
  // read backwards across a year end.
  const reported: DeliveryMonth[] = rows
    .map((r) => ({ ...r, reported: true }))
    .sort((a, b) =>
      (periodDateKey(a.periodFrom) ?? "").localeCompare(
        periodDateKey(b.periodFrom) ?? "",
      ),
    );

  return padMissingMonths(reported, throughMonth).slice(-n);
}

/**
 * Append the calendar months between the newest import and `throughMonth`.
 *
 * Anchored on the newest REPORTED month, so browsing back to June pads nothing
 * — the tile then shows what was true in June rather than back-dating today's
 * gap onto it. With no import at all there is no anchor and nothing to pad:
 * the tiles' own "no monitoring import yet" state says it better than a row of
 * blanks would.
 */
function padMissingMonths(
  reported: DeliveryMonth[],
  throughMonth: string | undefined,
): DeliveryMonth[] {
  if (!throughMonth || reported.length === 0) return reported;
  const lastKey = periodDateKey(reported[reported.length - 1].periodFrom);
  if (!lastKey) return reported;

  const out = [...reported];
  let [year, month] = lastKey.slice(0, 7).split("-").map(Number);
  while (`${year}-${String(month).padStart(2, "0")}` < throughMonth) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const mm = String(month).padStart(2, "0");
    // Written in the stored "DD/MM/YYYY HH:MM:SS" shape so `monthLabel` and
    // every other period reader treat a filled month like an imported one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    out.push({
      periodFrom: `01/${mm}/${year} 00:00:00`,
      periodTo: `${lastDay}/${mm}/${year} 23:59:59`,
      impressions: 0,
      clicks: 0,
      cost: 0,
      matchedImpressions: 0,
      reported: false,
    });
  }
  return out;
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
