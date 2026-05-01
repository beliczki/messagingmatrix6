import { NextResponse } from "next/server";
import {
  createTextFormatting,
  listTextFormatting,
  pickWritable,
  TextFormattingError,
} from "@/lib/entities/text-formatting";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    text_formatting: listTextFormatting(claims.cid, { includeArchived }),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body);
  try {
    const row = createTextFormatting(claims.cid, input);
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "text_formatting",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ rule: row }, { status: 201 });
  } catch (e) {
    if (e instanceof TextFormattingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
