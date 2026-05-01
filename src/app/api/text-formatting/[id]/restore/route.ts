import { NextResponse } from "next/server";
import {
  getTextFormatting,
  restoreTextFormatting,
} from "@/lib/entities/text-formatting";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  missingVersion,
  readClientVersion,
  versionMismatch,
} from "@/lib/optimistic";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const expected = readClientVersion(req, body);
  if (expected === null) return missingVersion();
  const before = getTextFormatting(claims.cid, id);
  const result = restoreTextFormatting(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "text_formatting",
    entityId: id,
    action: "restore",
    before,
    after: result.row,
  });
  return NextResponse.json({ rule: result.row });
});
