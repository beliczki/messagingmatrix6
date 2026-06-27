import { NextResponse } from "next/server";
import { archiveFile, getFile } from "@/lib/entities/files";
import { readFileBytes } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { denyDemo, withSession } from "@/lib/scoped";

type Params = { id: string };

export const GET = withSession<Params>(async ({ claims, params }) => {
  const row = await getFile(claims.cid, params.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(row.storagePath);
  } catch {
    return NextResponse.json(
      { error: "storage_missing" },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType ?? "application/octet-stream",
      "Content-Length": String(row.sizeBytes ?? bytes.length),
      "Cache-Control": "private, max-age=300",
    },
  });
});

export const DELETE = withSession<Params>(async ({ claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const before = await getFile(claims.cid, params.id);
  const result = await archiveFile(claims.cid, params.id);
  if (!result.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "uploaded_files",
    entityId: params.id,
    action: "archive",
    before,
    after: { ...result.row, archivedAt: new Date().toISOString() },
  });
  return NextResponse.json({ file: result.row });
});
