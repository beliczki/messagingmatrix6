import { NextResponse } from "next/server";
import {
  archiveMessage,
  getMessage,
  listDrafts,
  MessageError,
  promoteDraft,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// Promote SOME OR ALL variants of one draft MC in a single call:
//   { ids: number[], audienceKey, topicKey, status?, archiveRest?: boolean }
//
// The drafts wall is one card per MC number now, so the decision the user makes
// is about the card: which of its variants go, where they go, and what happens
// to the ones that stay. A loop of single-row calls from the browser would make
// that one decision arrive as N requests with N chances to half-apply.
//
// **Promotion converts.** The row stops being a draft and becomes the card —
// there is no copy and no duplicate (user, 2026-09-10). So `archiveRest` is
// about the variants that were NOT promoted: "Promote" leaves them on the wall,
// "Promote and archive" shelves them, and their number stays retired either way.
//
// Letter order matters: promoting `a` before `b` is what lets the target cell
// hand out the same letters the draft used. Out of order, `b` would land first
// and `a` would collide with it.
//
// One audience, deliberately: the axis is whatever the chosen key is (a channel
// key is an Agentic placement — promoteDraft resolves both through the same
// lookup). The "both" fan-out lives on /api/drafts/[id]/promote, which is
// untouched and still serves MCP and the single-card path.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { ids, audienceKey, topicKey, status, archiveRest } = body as Record<
    string,
    unknown
  >;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((n) => Number.isInteger(n))
  ) {
    return NextResponse.json({ error: "ids are required" }, { status: 400 });
  }
  if (typeof audienceKey !== "string" || typeof topicKey !== "string") {
    return NextResponse.json(
      { error: "audienceKey and topicKey are required" },
      { status: 400 },
    );
  }

  // Resolve every row up front so a bad id fails before anything is written.
  const rows = [];
  for (const id of ids as number[]) {
    const row = await getMessage(claims.cid, id);
    if (!row) {
      return NextResponse.json({ error: `draft ${id} not found` }, { status: 404 });
    }
    if (row.status !== "DRAFT") {
      return NextResponse.json(
        { error: `MC${row.number}${row.variant} is already in the matrix` },
        { status: 409 },
      );
    }
    rows.push(row);
  }
  const numbers = new Set(rows.map((r) => r.number));
  if (numbers.size !== 1) {
    return NextResponse.json(
      { error: "all ids must be variants of one MC number" },
      { status: 400 },
    );
  }
  rows.sort((a, b) => a.variant.localeCompare(b.variant));

  const promoted = [];
  try {
    for (const row of rows) {
      const result = await promoteDraft(claims.cid, row.id, {
        audienceKey,
        topicKey,
        expectedVersion: row.version,
        status: typeof status === "string" ? status : undefined,
      });
      await writeAudit({
        clientId: claims.cid,
        userId: claims.sub,
        entityType: "messages",
        entityId: result.id,
        action: "update",
        before: row,
        after: result,
      });
      promoted.push(result);
    }

    let archived = 0;
    if (archiveRest === true) {
      // Whatever still holds this number and is still a draft. Re-read rather
      // than diffing the input: the ids the caller sent are the ones it could
      // see, and a variant added meanwhile is exactly the row that must not be
      // left behind on a card the user just cleared.
      const number = rows[0]!.number;
      const remaining = (await listDrafts(claims.cid)).filter(
        (d) => d.number === number,
      );
      for (const d of remaining) {
        const res = await archiveMessage(claims.cid, d.id, d.version);
        if (res.ok) {
          archived += 1;
          await writeAudit({
            clientId: claims.cid,
            userId: claims.sub,
            entityType: "messages",
            entityId: d.id,
            action: "archive",
            before: d,
            after: res.row,
          });
        }
      }
    }

    return NextResponse.json({ promoted, archived });
  } catch (e) {
    if (e instanceof MessageError) {
      // Partial application is reported, not hidden: the rows that went are
      // real cards now, and the caller has to see which ones to know what it
      // is looking at after the refresh.
      return NextResponse.json(
        { error: e.message, promoted: promoted.map((p) => p.id) },
        { status: 400 },
      );
    }
    throw e;
  }
});
