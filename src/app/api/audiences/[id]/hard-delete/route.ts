import { NextResponse } from "next/server";
import { deleteAudience, getAudience } from "@/lib/entities/audiences";
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
  const before = getAudience(claims.cid, id);
  const result = deleteAudience(claims.cid, id, expected);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (result.reason === "version_mismatch") {
      return versionMismatch(result.current, result.current.version);
    }
    return NextResponse.json(
      { error: "in_use", referencedBy: result.referencedBy },
      { status: 409 },
    );
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "audiences",
    entityId: id,
    action: "delete",
    before,
  });
  return NextResponse.json({ ok: true });
});
