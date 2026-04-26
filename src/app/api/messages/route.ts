import { NextResponse } from "next/server";
import {
  createMessage,
  listMessages,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ req, claims }) => {
  const includeDeleted =
    new URL(req.url).searchParams.get("includeDeleted") === "1";
  return NextResponse.json({
    messages: listMessages(claims.cid, { includeDeleted }),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  try {
    const row = createMessage(claims.cid, input);
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ message: row }, { status: 201 });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
