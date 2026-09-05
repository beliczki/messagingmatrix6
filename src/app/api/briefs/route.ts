import { NextResponse } from "next/server";
import {
  attachBriefByLink,
  BriefError,
  listBriefsWithProgress,
} from "@/lib/entities/briefs";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    briefs: await listBriefsWithProgress(claims.cid, { includeArchived }),
  });
});

// Attach a brief by pasting its link. Idempotent by file id: pasting the same
// deck again — or the Drive link where someone pasted the editor link — returns
// the existing brief rather than creating a second one.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { link, label } = body as Record<string, unknown>;
  if (typeof link !== "string" || !link.trim()) {
    return NextResponse.json({ error: "link is required" }, { status: 400 });
  }
  try {
    const row = await attachBriefByLink(
      claims.cid,
      link,
      typeof label === "string" ? label : null,
    );
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "briefs",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ brief: row }, { status: 201 });
  } catch (e) {
    if (e instanceof BriefError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
