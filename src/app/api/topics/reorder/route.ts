import { NextResponse } from "next/server";
import { listTopics, reorderTopics } from "@/lib/entities/topics";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// Drag-drop reorder of topic rows/columns from the matrix edit mode. See
// audiences/reorder — same contract and guard. Only DCO topics carry a real
// orderIndex; Agentic rows are synthesized client-side and are never sent here.
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
  const before = (await listTopics(claims.cid)).filter((r) => idSet.has(r.id));
  await reorderTopics(claims.cid, ids as number[]);
  const after = (await listTopics(claims.cid)).filter((r) => idSet.has(r.id));
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "topics",
    entityId: "reorder",
    action: "bulk_update",
    before: before.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
    after: after.map((r) => ({ id: r.id, orderIndex: r.orderIndex })),
  });
  return NextResponse.json({ topics: after });
});
