import { NextResponse } from "next/server";
import {
  createDraft,
  listDrafts,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// The drafts surface. A draft is a `messages` row with no audience, so it needs
// nothing here but the rows: the page renders each card live from its template
// (the same /api/render the matrix grid uses), and a card with a template can
// always be rendered — so there are no shot PNGs to ship and nothing to go
// stale. `briefs` is gone for a different reason: the deck a draft came in on
// is a column on the draft itself now, so the card carries it.
export const GET = withSession(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    drafts: await listDrafts(claims.cid, { includeArchived }),
  });
});

// Take work on: claims an MC number now, cell decided later.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body ?? {});
  try {
    const row = await createDraft(claims.cid, input);
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ draft: row }, { status: 201 });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
