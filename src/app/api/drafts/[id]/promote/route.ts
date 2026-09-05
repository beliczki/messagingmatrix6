import { NextResponse } from "next/server";
import { getMessage, MessageError, promoteDraft } from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

// Place a draft into a cell: body { audienceKey, topicKey, status?, version? }.
// The row is updated rather than replaced, so the audit entry is an `update` on
// the message that already existed — the draft and the card are one MC.
export const POST = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { audienceKey, topicKey, status, version } = body as Record<
    string,
    unknown
  >;
  if (typeof audienceKey !== "string" || typeof topicKey !== "string") {
    return NextResponse.json(
      { error: "audienceKey and topicKey are required" },
      { status: 400 },
    );
  }
  const before = await getMessage(claims.cid, id);
  try {
    const row = await promoteDraft(claims.cid, id, {
      audienceKey,
      topicKey,
      status: typeof status === "string" ? status : undefined,
      expectedVersion: typeof version === "number" ? version : undefined,
    });
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: id,
      action: "update",
      before,
      after: row,
    });
    return NextResponse.json({ message: row });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
