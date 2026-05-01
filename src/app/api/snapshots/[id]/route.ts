import { NextResponse } from "next/server";
import { deleteSnapshot, getSnapshot } from "@/lib/snapshots";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const DELETE = withAdmin<Params>(({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const before = getSnapshot(claims.cid, id);
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  deleteSnapshot(claims.cid, id);
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "snapshots",
    entityId: id,
    action: "delete",
    before: { id: before.id, label: before.label, createdAt: before.createdAt },
  });
  return NextResponse.json({ ok: true });
});
