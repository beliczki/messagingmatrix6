import { NextResponse } from "next/server";
import { deleteDraft, getDraft } from "@/lib/entities/drafts";
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

export const GET = withSession<Params>(async ({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const res = await getDraft(claims.cid, id);
  if (!res) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ draft: res.draft, previews: res.previews });
});

// HARD delete — drafts are throwaway staging, no archive/restore (the preview
// PNGs are purged with the row).
export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const result = await deleteDraft(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "draft_messages",
    entityId: id,
    action: "delete",
    before: result.draft,
  });
  return NextResponse.json({ ok: true });
});
