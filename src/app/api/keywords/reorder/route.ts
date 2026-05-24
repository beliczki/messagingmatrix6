import { NextResponse } from "next/server";
import { listKeywords, reorderKeywords } from "@/lib/entities/keywords";
import { denyDemo, withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const POST = withAdmin(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { form, field, ids } = body as Record<string, unknown>;
  if (typeof form !== "string" || typeof field !== "string") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (
    !Array.isArray(ids) ||
    !ids.every((x) => Number.isInteger(x) && (x as number) > 0)
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const before = listKeywords(claims.cid, { form, field });
  reorderKeywords(claims.cid, form, field, ids as number[]);
  const after = listKeywords(claims.cid, { form, field });
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "keywords",
    entityId: `${form}:${field}`,
    action: "bulk_update",
    before: before.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
    after: after.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
  });
  return NextResponse.json({ keywords: after });
});
