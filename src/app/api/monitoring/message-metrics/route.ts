import { NextResponse } from "next/server";
import { messageMetrics } from "@/lib/sankey-metrics";
import { withSession } from "@/lib/scoped";

// GET /api/monitoring/message-metrics?period=DD/MM/YYYY
//
// Per-message impressions / cost / conversions for one report period, plus the
// period list and how much of each metric is attributable to a message at all.
// Feeds the matrix sankey's metric weighting: the diagram can only draw the
// matched part, so the caller is handed the coverage to say so on screen.
export const GET = withSession(async ({ req, claims }) => {
  const period = new URL(req.url).searchParams.get("period") ?? undefined;
  return NextResponse.json(await messageMetrics(claims.cid, period));
});
