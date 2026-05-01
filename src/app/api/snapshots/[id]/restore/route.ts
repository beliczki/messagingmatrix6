import { NextResponse } from "next/server";
import { getSnapshot, restoreSnapshot } from "@/lib/snapshots";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST = withAdmin<Params>(({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const snap = getSnapshot(claims.cid, id);
  if (!snap) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = restoreSnapshot(claims.cid, id);
  if (!result.ok) {
    return NextResponse.json(
      { error: "restore_failed" },
      { status: 500 },
    );
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "snapshots",
    entityId: id,
    action: "snapshot_restore",
    before: { id: snap.id, label: snap.label, createdAt: snap.createdAt },
    after: { counts: result.counts },
  });
  return NextResponse.json({ ok: true, counts: result.counts });
});
