import { NextResponse } from "next/server";
import { deleteDraft } from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// HARD delete, and only for a draft.
//
// `DELETE /api/messages/[id]` archives, which is right for a card that lived:
// it was trafficked, it may be in a report, and its number must stay retired.
// A draft that was created by mistake was none of those things, and archiving
// one burns an MC number to record that nothing happened. So this route exists
// separately rather than as a flag on that one — the two are different acts,
// and the guard against calling this on a placed row lives in the entity.
//
// Concurrency: the expected version comes from the `if-match` header, the same
// contract as every other write in the app.
export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const raw = req.headers.get("if-match");
  const expected = raw === null ? null : Number(raw);
  if (expected === null || !Number.isInteger(expected)) {
    return NextResponse.json({ error: "missing_version" }, { status: 428 });
  }

  const result = await deleteDraft(claims.cid, id, expected);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.reason === "not_a_draft") {
      return NextResponse.json(
        {
          error:
            "that card has a cell — archive it from the matrix instead of deleting it",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "version_conflict", current: result.current },
      { status: 409 },
    );
  }

  // The row is gone; the audit entry is the only place its before-state
  // survives, which is exactly why it carries the whole row.
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: id,
    action: "delete",
    before: result.row,
  });
  return NextResponse.json({ deleted: id });
});
