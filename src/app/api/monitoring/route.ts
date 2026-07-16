import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { monitoring, messages as messagesTable } from "@/db/schema";
import { withSession } from "@/lib/scoped";

// GET /api/monitoring — read back imported monitoring data for the active
// client. Returns the list of report periods (newest first) plus the rows for
// one selected period (defaults to the newest), each left-joined to its matrix
// message for name/status. One period is ~850 rows, comfortably under the
// PostgREST/SQLite truncation ceiling; the period selector keeps it that way.

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
    .groupBy(monitoring.periodFrom, monitoring.periodTo)
    .orderBy(desc(monitoring.periodFrom));

  if (periods.length === 0) {
    return NextResponse.json({ periods: [], selected: null, rows: [] });
  }

  const requested = req.nextUrl.searchParams.get("from");
  const selected =
    periods.find((p) => p.periodFrom === requested) ?? periods[0];

  const rows = await db
    .select({
      id: monitoring.id,
      platform: monitoring.platform,
      product: monitoring.product,
      size: monitoring.size,
      pmmid: monitoring.pmmid,
      messageId: monitoring.messageId,
      matchLevel: monitoring.matchLevel,
      audienceKey: monitoring.audienceKey,
      topicKey: monitoring.topicKey,
      mcNumber: monitoring.mcNumber,
      mcVariant: monitoring.mcVariant,
      impressions: monitoring.impressions,
      clicks: monitoring.clicks,
      cost: monitoring.cost,
      conversions: monitoring.conversions,
      ctr: monitoring.ctr,
      messageName: messagesTable.name,
      messageStatus: messagesTable.status,
    })
    .from(monitoring)
    .leftJoin(messagesTable, eq(monitoring.messageId, messagesTable.id))
    .where(
      and(
        eq(monitoring.clientId, claims.cid),
        eq(monitoring.periodFrom, selected.periodFrom),
      ),
    )
    .orderBy(desc(monitoring.impressions));

  return NextResponse.json({
    periods,
    selected: { periodFrom: selected.periodFrom, periodTo: selected.periodTo },
    rows,
  });
});
