import { NextResponse } from "next/server";
import {
  listDrafts,
  listPreviewsForDrafts,
} from "@/lib/entities/drafts";
import { withSession } from "@/lib/scoped";

// Draft test-creatives list for the /drafts page. Previews are bundled so the
// tiles render without per-draft roundtrips.
export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const includePromoted = url.searchParams.get("includePromoted") === "1";
  const drafts = await listDrafts(claims.cid, { includePromoted });
  const previews = await listPreviewsForDrafts(
    claims.cid,
    drafts.map((d) => d.id),
  );
  return NextResponse.json({ drafts, previews });
});
