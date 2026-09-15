import { NextResponse } from "next/server";
import { archiveFile, getFile } from "@/lib/entities/files";
import { readFileStream } from "@/lib/storage";
import { parseRangeHeader } from "@/lib/http-range";
import { writeAudit } from "@/lib/audit";
import { denyDemo, withSession } from "@/lib/scoped";

type Params = { id: string };

// Bytes are STREAMED, never buffered whole: a video served without `Range`
// support forces the browser to download the entire clip before it can paint a
// single frame, which is what left every video preview box empty for as long as
// the file took to come down from the object store.
export const GET = withSession<Params>(async ({ req, claims, params }) => {
  const row = await getFile(claims.cid, params.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const contentType = row.mimeType ?? "application/octet-stream";
  const total = row.sizeBytes ?? 0;
  const range = parseRangeHeader(req.headers.get("range"), total);

  if (range.kind === "unsatisfiable") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
    });
  }

  let stream;
  try {
    stream = await readFileStream(
      row.storagePath,
      range.kind === "range" ? { start: range.start, end: range.end } : undefined,
    );
  } catch {
    return NextResponse.json({ error: "storage_missing" }, { status: 410 });
  }

  if (range.kind === "range") {
    return new NextResponse(stream.body, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stream.contentLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  return new NextResponse(stream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stream.contentLength),
      "Accept-Ranges": "bytes",
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
