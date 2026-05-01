import { NextResponse } from "next/server";
import {
  archiveAsset,
  getAsset,
  pickWritable,
  updateAsset,
} from "@/lib/entities/assets";
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
  const row = getAsset(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ asset: row });
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
  const before = getAsset(claims.cid, id);
  const result = updateAsset(claims.cid, id, expected, input);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "assets",
    entityId: id,
    action: "update",
    before,
    after: result.row,
  });
  return NextResponse.json({ asset: result.row });
});

export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const before = getAsset(claims.cid, id);
  const result = archiveAsset(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "assets",
    entityId: id,
    action: "archive",
    before,
    after: result.row,
  });
  return NextResponse.json({ asset: result.row });
});
