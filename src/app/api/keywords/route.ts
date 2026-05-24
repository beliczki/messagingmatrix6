import { NextResponse } from "next/server";
import {
  createKeyword,
  KEYWORD_FIELDS,
  KeywordError,
  listKeywords,
} from "@/lib/entities/keywords";
import { denyDemo, withAdmin, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withSession(({ req, claims }) => {
  const url = new URL(req.url);
  const form = url.searchParams.get("form") ?? undefined;
  const field = url.searchParams.get("field") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  return NextResponse.json({
    keywords: listKeywords(claims.cid, { form, field, includeArchived }),
    schema: KEYWORD_FIELDS,
  });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { form, field, value, orderIndex } = body as Record<string, unknown>;
  try {
    const row = createKeyword(claims.cid, {
      form: String(form ?? ""),
      field: String(field ?? ""),
      value: String(value ?? ""),
      orderIndex:
        typeof orderIndex === "number" ? orderIndex : undefined,
    });
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "keywords",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ keyword: row }, { status: 201 });
  } catch (e) {
    if (e instanceof KeywordError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
