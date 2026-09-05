import { NextResponse } from "next/server";
import {
  archiveBrief,
  getBrief,
  restoreBrief,
  updateBrief,
} from "@/lib/entities/briefs";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const GET = withSession<Params>(async ({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = await getBrief(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ brief: row });
});

// Label only. The file id is the brief's identity and is never edited — a
// different deck is a different brief, attached by pasting its link.
export const PATCH = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { label, restore } = body as Record<string, unknown>;
  const before = await getBrief(claims.cid, id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const row =
    restore === true
      ? await restoreBrief(claims.cid, id)
      : await updateBrief(claims.cid, id, {
          label: typeof label === "string" ? label : null,
        });
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "briefs",
    entityId: id,
    action: "update",
    before,
    after: row,
  });
  return NextResponse.json({ brief: row });
});

// Archive, not delete: brief_id is ON DELETE SET NULL, so a hard delete would
// quietly cut every draft loose from the reason it exists.
export const DELETE = withSession<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const before = await getBrief(claims.cid, id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await archiveBrief(claims.cid, id);
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "briefs",
    entityId: id,
    action: "archive",
    before,
    after: row,
  });
  return NextResponse.json({ brief: row });
});
