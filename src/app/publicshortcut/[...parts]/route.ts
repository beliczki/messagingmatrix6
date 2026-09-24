import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creatives, messagePreviews, uploadedFiles } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import { readFileBytes, readFileStream } from "@/lib/storage";
import { parseRangeHeader } from "@/lib/http-range";
import { verifyToken } from "@/lib/public-shortcut";

// The public image surface. Everything here is reachable without a session,
// and the SIGNATURE in the token is what stands in for one — see
// lib/public-shortcut.ts for why that is a signature and not a cipher.
//
//   /publicshortcut/m<message_id>.<sig>/<size>   the DCO preview PNG
//   /publicshortcut/c<creative_id>.<sig>         the agentic creative file
//   ...?html=1                                   the same image on a bare page
//   ...?v=<updated_at>                           cache-buster, outside the signature
//
// No status gate: a DRAFT preview is served like any other, because watching a
// draft take shape is exactly what a client's agent is handed a link for
// (user decision, 2026-09-24). Archived rows are not served — those are gone,
// not private.
//
// Every failure is the same 404 — bad signature, no secret configured, unknown
// size, missing row — so a probe cannot tell which of them it hit.

type Params = { parts: string[] };

const notFound = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

// A bare page with the image in the top-left corner, sized exactly. `margin:0`
// on both html and body: the default 8px body margin would otherwise push the
// image off the corner the caller asked for.
function htmlPage(src: string, width: number | null, height: number | null) {
  const size =
    width && height ? `width:${width}px;height:${height}px;` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>html,body{margin:0;padding:0;background:#fff}img{display:block;${size}}</style>
</head><body><img src="${src}" alt="" /></body></html>`;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const { parts } = await ctx.params;
  const [token, size] = parts;
  if (!token) return notFound();

  const claim = await verifyToken(token);
  if (!claim) return notFound();

  const url = new URL(req.url);
  const wantHtml = url.searchParams.get("html") !== null;
  const clientId = await activeClientId();

  if (claim.kind === "m") {
    // The size is part of the address, not of the signature: one signed message
    // token opens every size the template declares, which is what lets a caller
    // swap 300x250 for 970x250 without asking for a new link.
    if (!size || parts.length > 2) return notFound();
    const [row] = await db
      .select()
      .from(messagePreviews)
      .where(
        and(
          eq(messagePreviews.clientId, clientId),
          eq(messagePreviews.messageId, claim.id),
          eq(messagePreviews.size, size),
        ),
      )
      .limit(1);
    if (!row) return notFound();

    if (wantHtml) {
      const [w, h] = row.size.split("x").map((n) => Number(n));
      return new NextResponse(
        htmlPage(
          `/publicshortcut/${encodeURIComponent(token)}/${encodeURIComponent(row.size)}`,
          Number.isFinite(w) ? w! : null,
          Number.isFinite(h) ? h! : null,
        ),
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    }

    let bytes: Buffer;
    try {
      bytes = await readFileBytes(row.storageKey);
    } catch {
      return NextResponse.json({ error: "storage_missing" }, { status: 410 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        // Same reasoning as /api/previews/[id]: the address is stable across
        // regens while the bytes are not, so the window stays short and the
        // callers carry ?v=<updated_at>.
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  // kind === "c" — an agentic creative, served as the file it is.
  if (parts.length > 1) return notFound();
  const [creative] = await db
    .select({ fileId: creatives.fileId })
    .from(creatives)
    .where(
      and(
        eq(creatives.clientId, clientId),
        eq(creatives.id, claim.id),
        isNull(creatives.archivedAt),
      ),
    )
    .limit(1);
  if (!creative?.fileId) return notFound();

  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.id, creative.fileId),
        eq(uploadedFiles.clientId, clientId),
        isNull(uploadedFiles.archivedAt),
      ),
    )
    .limit(1);
  if (!file) return notFound();

  if (wantHtml) {
    const [w, h] = (file.dimensions ?? "").split("x").map((n) => Number(n));
    return new NextResponse(
      htmlPage(
        `/publicshortcut/${encodeURIComponent(token)}`,
        Number.isFinite(w) ? w! : null,
        Number.isFinite(h) ? h! : null,
      ),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  // Streamed with Range support, like /share/[id]/file/[fileId]: a video served
  // without it forces the whole clip down before the browser paints a frame.
  const contentType = file.mimeType ?? "application/octet-stream";
  const total = file.sizeBytes ?? 0;
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
      file.storagePath,
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
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  return new NextResponse(stream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stream.contentLength),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=300",
    },
  });
}
