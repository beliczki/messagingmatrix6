import { NextResponse } from "next/server";
import {
  archiveMessage,
  getMessage,
  pickWritable,
  updateMessage,
} from "@/lib/entities/messages";
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
  const row = getMessage(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ message: row });
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
  const before = getMessage(claims.cid, id);
  const result = updateMessage(claims.cid, id, expected, input);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: id,
    action: "update",
    before,
    after: result.row,
  });
  return NextResponse.json({ message: result.row });
});

export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const before = getMessage(claims.cid, id);
  const result = archiveMessage(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: id,
    action: "archive",
    before,
    after: result.row,
  });
  return NextResponse.json({ message: result.row });
});
