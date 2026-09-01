import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { resolveDayScope } from "@/lib/day-scope";
import { listStripCreatives, STRIP_PAGE } from "@/lib/dashboard-creatives";

// Paging for the dashboard creative strip — the page renders the first page
// itself, this serves every page the strip scrolls into.
export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const scope = resolveDayScope(
    url.searchParams.get("d") ?? undefined,
    url.searchParams.get("r") ?? undefined,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const page = await listStripCreatives(claims.cid, scope, offset, STRIP_PAGE);
  return NextResponse.json(page);
});
