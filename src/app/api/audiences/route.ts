import { NextResponse } from "next/server";
import {
  BadRequest,
  createAudience,
  listAudiences,
  pickWritable,
} from "@/lib/entities/audiences";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { denyDemo } from "@/lib/scoped";

export const GET = withSession(({ claims }) => {
  return NextResponse.json({ audiences: listAudiences(claims.cid) });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  try {
    const row = createAudience(claims.cid, input);
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "audiences",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ audience: row }, { status: 201 });
  } catch (e) {
    if (e instanceof BadRequest) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
