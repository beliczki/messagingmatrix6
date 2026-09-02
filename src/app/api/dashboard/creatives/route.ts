import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { resolveDayScope } from "@/lib/day-scope";
import {
  listStripCreatives,
  STRIP_PAGE,
  type StripSort,
} from "@/lib/dashboard-creatives";

// Paging for the dashboard creative strip — the page renders the first page
// itself, this serves every page the strip scrolls into.
export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const scope = resolveDayScope(
    url.searchParams.get("d") ?? undefined,
    url.searchParams.get("r") ?? undefined,
  );
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);
  const products = (url.searchParams.get("p") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sort: StripSort = url.searchParams.get("cs") === "ctr" ? "ctr" : "time";
  const page = await listStripCreatives(
    claims.cid,
    scope,
    offset,
    STRIP_PAGE,
    products,
    sort,
  );
  return NextResponse.json(page);
});
