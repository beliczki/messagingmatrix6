import { NextResponse } from "next/server";
import { readEntityHistory } from "@/lib/audit";
import { withSession } from "@/lib/scoped";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Revision history for one MC (message) — the audit-log `before`/`after`
// snapshots.
export const GET = withSession<Params>(({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  return NextResponse.json({
    history: readEntityHistory(claims.cid, "messages", id),
  });
});
