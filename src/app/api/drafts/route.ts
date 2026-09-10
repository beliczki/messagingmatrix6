import { NextResponse } from "next/server";
import {
  createDraft,
  createDraftVariant,
  listDrafts,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";
import { listCreativeMatchesForMcs } from "@/lib/entities/creatives";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// The drafts surface. A draft is a `messages` row with no audience, so it needs
// nothing here but the rows: the page renders each card live from its template
// (the same /api/render the matrix grid uses), and a card with a template can
// always be rendered — so there are no shot PNGs to ship and nothing to go
// stale. `briefs` is gone for a different reason: the deck a draft came in on
// is a column on the draft itself now, so the card carries it.
//
// `matches` rides along as a SIBLING key rather than as fields on each row:
// the rows are `messages` rows and the same objects are handed to the editor,
// so three computed fields dressed as columns would drift the moment anyone
// read one on the matrix side, where they do not exist. Keyed by
// "number|variant" — the match belongs to the MC, not to the row.
export const GET = withSession(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const drafts = await listDrafts(claims.cid, { includeArchived });
  const matches = await listCreativeMatchesForMcs(
    claims.cid,
    drafts.map((d) => ({ number: d.number, variant: d.variant })),
  );
  return NextResponse.json({
    drafts,
    matches: Object.fromEntries(matches),
  });
});

// Take work on: claims an MC number now, cell decided later.
//
// `from_draft_id` turns this into "another variant of that draft" (MC404a →
// MC404b). It is read off the RAW body rather than through pickWritable
// because it is an allocation directive, not a field — `number`/`variant` are
// deliberately absent from WRITABLE_FIELDS, and this must not be the hole that
// smuggles them back in. Same shape as /api/messages' mc_number handling.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const raw = (body ?? {}) as Record<string, unknown>;
  const input = pickWritable(raw);
  const fromDraftId =
    typeof raw.from_draft_id === "number" ? raw.from_draft_id : null;
  const mode = raw.mode === "empty" ? "empty" : "duplicate";
  try {
    const row =
      fromDraftId !== null
        ? await createDraftVariant(claims.cid, fromDraftId, mode)
        : await createDraft(claims.cid, input);
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
