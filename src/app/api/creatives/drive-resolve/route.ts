import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { DriveError } from "@/lib/drive";
import { resolveDriveFilesForCreatives } from "@/lib/drive-resolve";
import { denyDemo, withSession } from "@/lib/scoped";

// The Drive link health check. The client sends the ids it wants checked (the
// filtered Creative Library view, chunked), so the batch size is the caller's
// decision and this route never has to page a growing table itself.
const MAX_IDS = 200;

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;

  const body = (await req.json().catch(() => null)) as {
    creativeIds?: unknown;
  } | null;
  const ids = Array.isArray(body?.creativeIds)
    ? body.creativeIds.filter(
        (v): v is number => Number.isInteger(v) && (v as number) > 0,
      )
    : null;
  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "creative_ids_required" }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: "too_many_ids", maxIds: MAX_IDS },
      { status: 400 },
    );
  }

  let report;
  try {
    report = await resolveDriveFilesForCreatives(claims.cid, ids);
  } catch (e) {
    if (e instanceof DriveError) {
      return NextResponse.json(
        { error: "drive_unavailable", detail: e.message },
        { status: 502 },
      );
    }
    throw e;
  }

  // One audit row per run, not per creative: a health check over a filtered
  // view touches hundreds of rows and would otherwise bury the activity log.
  // It rides the existing bulk_update action — that is what it is, and the
  // dashboard digest already knows how to render it.
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "creatives",
    entityId: 0,
    action: "bulk_update",
    after: { kind: "drive_resolve", requested: ids.length, ...report.counts },
  });

  return NextResponse.json(report);
});
