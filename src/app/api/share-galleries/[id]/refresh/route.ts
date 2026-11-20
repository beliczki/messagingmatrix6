import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { refreshShare, warmShareStills } from "@/lib/share-snapshot";

// Re-reads the share's MCs, creatives and files so the link shows their current
// content, and swaps a creative for its newer version (n1 → n2) in its place,
// comments included. Order and the other items are untouched.
export const POST = withSession<{ id: string }>(async ({ claims, params }) => {
  const result = await refreshShare(claims.cid, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  await warmShareStills(claims.cid, params.id, result.newFileIds);
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "share_galleries",
    entityId: params.id,
    action: "update",
    after: {
      id: params.id,
      title: result.title,
      refreshed: result.changed,
      replaced: result.replaced,
    },
  });
  return NextResponse.json({ ok: true, changed: result.changed, replaced: result.replaced });
});
