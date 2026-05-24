import { NextResponse } from "next/server";
import { getKeyword, restoreKeyword } from "@/lib/entities/keywords";
import { denyDemo, withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST = withAdmin<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const before = getKeyword(claims.cid, id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = restoreKeyword(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "keywords",
    entityId: id,
    action: "restore",
    before,
    after: row,
  });
  return NextResponse.json({ keyword: row });
});
