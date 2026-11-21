import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { previewShareRefresh, refreshShare, warmShareStills } from "@/lib/share-snapshot";

// What a refresh would swap (n1 → n2), for the confirm dialog. Reads only — the
// same plan the POST runs, so the dialog shows what the refresh then does.
export const GET = withSession<{ id: string }>(async ({ claims, params }) => {
  const result = await previewShareRefresh(claims.cid, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ replaced: result.replaced });
});

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
