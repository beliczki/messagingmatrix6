import { NextResponse } from "next/server";
import {
  createAsset,
  listAssets,
  pickWritable,
} from "@/lib/entities/assets";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    assets: listAssets(claims.cid, { includeArchived }),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  const row = createAsset(claims.cid, input);
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "assets",
    entityId: row.id,
    action: "create",
    after: row,
  });
  return NextResponse.json({ asset: row }, { status: 201 });
});
