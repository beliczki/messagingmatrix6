import { NextResponse } from "next/server";
import { createSnapshot, listSnapshots } from "@/lib/snapshots";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const GET = withAdmin(async ({ claims }) => {
  return NextResponse.json({ snapshots: await listSnapshots(claims.cid) });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  const labelRaw = typeof body?.label === "string" ? body.label.trim() : "";
  if (!labelRaw) {
    return NextResponse.json(
      { error: "label is required" },
      { status: 400 },
    );
  }
  const meta = await createSnapshot(claims.cid, labelRaw, claims.sub);
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "snapshots",
    entityId: meta.id,
    action: "create",
    after: { id: meta.id, label: meta.label, counts: meta.counts },
  });
  return NextResponse.json({ snapshot: meta }, { status: 201 });
});
