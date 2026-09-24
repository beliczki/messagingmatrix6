import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/scoped";
import { scanApiRoutes } from "@/lib/api-docs";

// Admin-only inventory of the deploy's HTTP surface — what Settings → API
// renders. Sibling of /api/mcp/tools and /api/schema: the page is generated
// from what is actually there, not from a list somebody keeps up to date.
export const GET = withAdmin(async () => {
  return NextResponse.json({ routes: scanApiRoutes() });
});
