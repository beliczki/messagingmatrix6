import { NextResponse } from "next/server";
import {
  createCreative,
  listCreatives,
  pickWritable,
} from "@/lib/entities/creatives";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ claims }) => {
  return NextResponse.json({ creatives: listCreatives(claims.cid) });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  const row = createCreative(claims.cid, input);
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "creatives",
    entityId: row.id,
    action: "create",
    after: row,
  });
  return NextResponse.json({ creative: row }, { status: 201 });
});
