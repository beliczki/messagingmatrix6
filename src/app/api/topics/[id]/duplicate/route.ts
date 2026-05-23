import { NextResponse } from "next/server";
import { duplicateTopic } from "@/lib/entities/topics";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST = withSession<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = duplicateTopic(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "topics",
    entityId: row.id,
    action: "create",
    after: row,
  });
  return NextResponse.json({ topic: row }, { status: 201 });
});
