import { NextResponse } from "next/server";
import { listAudiences, reorderAudiences } from "@/lib/entities/audiences";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// Drag-drop reorder of audience rows/columns from the matrix edit mode. The
// client sends the new id order of the currently visible axis subset; the entity
// permutes those ids within the orderIndex slots they already occupy. Guarded
// like the other matrix edit ops (withSession + denyDemo), not admin-only.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 2 ||
    !ids.every((x) => Number.isInteger(x) && (x as number) > 0)
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const idSet = new Set(ids as number[]);
  const before = (await listAudiences(claims.cid)).filter((r) => idSet.has(r.id));
  await reorderAudiences(claims.cid, ids as number[]);
  const after = (await listAudiences(claims.cid)).filter((r) => idSet.has(r.id));
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "audiences",
    entityId: "reorder",
    action: "bulk_update",
    before: before.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
    after: after.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
  });
  return NextResponse.json({ audiences: after });
});
