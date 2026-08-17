import { NextResponse } from "next/server";
import { withAdmin, denyDemo } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  archiveChannel,
  restoreChannel,
  updateChannel,
} from "@/lib/entities/channels";

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
  const body = (await req.json().catch(() => null)) as {
    code?: unknown;
    label?: unknown;
    orderIndex?: unknown;
    restore?: unknown;
  } | null;
  const patch: { code?: string; label?: string; orderIndex?: number } = {};
  if (typeof body?.code === "string") patch.code = body.code.trim();
  if (typeof body?.label === "string") patch.label = body.label.trim();
  if (typeof body?.orderIndex === "number") patch.orderIndex = body.orderIndex;
  const row = body?.restore
    ? await restoreChannel(claims.cid, id)
    : await updateChannel(claims.cid, id, patch);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "channels",
    entityId: id,
    action: "update",
    after: row,
  });
  return NextResponse.json({ channel: row });
});

export const DELETE = withAdmin<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = await archiveChannel(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "channels",
    entityId: id,
    action: "archive",
    after: row,
  });
  return NextResponse.json({ channel: row });
});
