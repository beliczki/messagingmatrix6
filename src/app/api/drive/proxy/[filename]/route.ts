import { NextResponse } from "next/server";
import { getFileByFilename } from "@/lib/entities/files";
import { readFileBytes } from "@/lib/storage";
import { withSession } from "@/lib/scoped";

type Params = { filename: string };

// Resolves a v5-style filename reference (messages.image1..6 / video1) back to
// an uploaded_files row in the active client and serves its bytes. The matrix
// templates' template.json hard-codes `path-messagingmatrix: "/api/drive/proxy/"`
// so the rendered HTML emits <img src="/api/drive/proxy/<filename>"> and we
// need to terminate that here.
export const GET = withSession<Params>(async ({ claims, params }) => {
  const filename = decodeURIComponent(params.filename);
  const row = await getFileByFilename(claims.cid, filename);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(row.storagePath);
  } catch {
    return NextResponse.json({ error: "storage_missing" }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": row.mimeType ?? "application/octet-stream",
      "Content-Length": String(row.sizeBytes ?? bytes.length),
      "Cache-Control": "private, max-age=300",
    },
  });
});
