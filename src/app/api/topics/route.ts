import { NextResponse } from "next/server";
import {
  createTopic,
  listTopics,
  pickWritable,
  TopicError,
} from "@/lib/entities/topics";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    topics: listTopics(claims.cid, { includeArchived }),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  try {
    const row = createTopic(claims.cid, input);
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "topics",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ topic: row }, { status: 201 });
  } catch (e) {
    if (e instanceof TopicError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
