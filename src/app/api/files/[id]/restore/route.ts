import { NextResponse } from "next/server";
import { getFile, restoreFile } from "@/lib/entities/files";
import { writeAudit } from "@/lib/audit";
import { denyDemo, withSession } from "@/lib/scoped";

type Params = { id: string };

export const POST = withSession<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const before = getFile(claims.cid, params.id);
  const result = restoreFile(claims.cid, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "uploaded_files",
    entityId: params.id,
    action: "restore",
    before,
    after: { ...result.row, archivedAt: null },
  });
  return NextResponse.json({ file: result.row });
});
