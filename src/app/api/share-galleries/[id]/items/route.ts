import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  addToShare,
  isEmptySelection,
  parseShareSelection,
  resolveShareSelection,
  warmShareStills,
} from "@/lib/share-snapshot";

// Adds the creative library's selection to an existing share. Items already in
// the share are skipped; the rest go at the end. Body: { matrix, creativeIds }.
export const POST = withSession<{ id: string }>(async ({ req, claims, params }) => {
  const selection = parseShareSelection(await req.json().catch(() => null));
  if (isEmptySelection(selection)) {
    return NextResponse.json(
      { error: "matrix or creativeIds (at least one non-empty) required" },
      { status: 400 },
    );
  }
  const resolved = await resolveShareSelection(claims.cid, selection);
  if (resolved.matrixItems.length === 0 && resolved.creatives.length === 0) {
    return NextResponse.json(
      { error: "no matching messages or creatives found in this client" },
      { status: 400 },
    );
  }

  const result = await addToShare(claims.cid, params.id, resolved);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await warmShareStills(claims.cid, params.id, result.newFileIds);

  if (result.added > 0) {
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "share_galleries",
      entityId: params.id,
      // An update of the snapshot, not a new action kind: every history view
      // already knows how to show one.
      action: "update",
      after: {
        id: params.id,
        title: result.title,
        added: result.added,
        skipped: result.skipped,
      },
    });
  }

  return NextResponse.json({
    share: { id: params.id, title: result.title },
    added: result.added,
    skipped: result.skipped,
  });
});
