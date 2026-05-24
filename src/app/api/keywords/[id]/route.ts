import { NextResponse } from "next/server";
import {
  archiveKeyword,
  getKeyword,
  KeywordError,
  updateKeyword,
} from "@/lib/entities/keywords";
import { denyDemo, withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const PATCH = withAdmin<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const before = getKeyword(claims.cid, id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { value, orderIndex } = body as Record<string, unknown>;
  try {
    const row = updateKeyword(claims.cid, id, {
      value: typeof value === "string" ? value : undefined,
      orderIndex: typeof orderIndex === "number" ? orderIndex : undefined,
    });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "keywords",
      entityId: id,
      action: "update",
      before,
      after: row,
    });
    return NextResponse.json({ keyword: row });
  } catch (e) {
    if (e instanceof KeywordError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});

export const DELETE = withAdmin<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const before = getKeyword(claims.cid, id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const row = archiveKeyword(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "keywords",
    entityId: id,
    action: "archive",
    before,
    after: row,
  });
  return NextResponse.json({ keyword: row });
});
