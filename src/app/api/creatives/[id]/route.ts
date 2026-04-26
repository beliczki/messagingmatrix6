import { NextResponse } from "next/server";
import {
  deleteCreative,
  getCreative,
  pickWritable,
  updateCreative,
} from "@/lib/entities/creatives";
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

export const GET = withSession<Params>(({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = getCreative(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ creative: row });
});

export const PATCH = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const expected = readClientVersion(req, body);
  if (expected === null) return missingVersion();
  const input = pickWritable(body);
  const before = getCreative(claims.cid, id);
  const result = updateCreative(claims.cid, id, expected, input);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "creatives",
    entityId: id,
    action: "update",
    before,
    after: result.row,
  });
  return NextResponse.json({ creative: result.row });
});

export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const result = deleteCreative(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "creatives",
    entityId: id,
    action: "delete",
    before: result.row,
  });
  return NextResponse.json({ ok: true });
});
