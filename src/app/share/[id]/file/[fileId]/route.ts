import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, shareGalleries, uploadedFiles } from "@/db/schema";
import { readFileBytes, readFileStream, resolveStoragePath } from "@/lib/storage";
import { parseRangeHeader } from "@/lib/http-range";
import {
  StillsUnavailableError,
  ensureStills,
  normalizeStillWidth,
  readStillResized,
} from "@/lib/video-stills";

// Public file proxy used by the share viewer. The viewer is unauthenticated,
// so we cannot hit /api/files/{id}. Instead, we gate access on the file id
// being referenced in this specific share gallery's snapshot metadata. That
// keeps the file private to anyone who has the share link, without exposing
// other files in the client.

type Params = { id: string; fileId: string };

const ALLOWED_THUMB_WIDTHS = [80, 200, 400, 800];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id, fileId } = await params;
  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, id))
    .limit(1);
  if (!share || share.archivedAt !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let referenced = false;
  if (share.metadata) {
    try {
      const meta = JSON.parse(share.metadata) as {
        files?: Array<{ id?: string }>;
      };
      referenced = (meta.files ?? []).some((f) => f?.id === fileId);
    } catch {
      // fall through to 404
    }
  }
  if (!referenced) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [file] = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, fileId))
    .limit(1);
  if (!file || file.clientId !== share.clientId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const thumbRaw = url.searchParams.get("thumb");
  const wantThumb = thumbRaw !== null;
  const isImage = file.mimeType?.startsWith("image/") ?? false;
  const isVideo = file.mimeType?.startsWith("video/") ?? false;

  const clientKey = async () => {
    const [client] = await db
      .select({ key: clients.key })
      .from(clients)
      .where(eq(clients.id, file.clientId))
      .limit(1);
    return client?.key ?? null;
  };

  // A video's stills, same strip the signed-in library scrubs — the viewer here
  // is unauthenticated and cannot reach /api/files, so it comes through this
  // proxy instead. `?stills` is the manifest, `?still=N` one frame, and a
  // `?thumb=` on a video is frame 0, so the gallery's existing poster URL works
  // for video without the caller knowing the difference.
  if (isVideo && (wantThumb || url.searchParams.has("stills") || url.searchParams.has("still"))) {
    const key = await clientKey();
    if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });
    try {
      if (url.searchParams.has("stills")) {
        const manifest = await ensureStills(key, file.id, file.storagePath);
        // Revalidates for the reason it does on the private route: the manifest
        // is what announces the strip's version, so it cannot carry one itself.
        return NextResponse.json(manifest, {
          headers: { "Cache-Control": "public, no-cache" },
        });
      }
      const rawIndex = url.searchParams.get("still");
      const index = rawIndex === null ? 0 : Number(rawIndex);
      if (!Number.isInteger(index) || index < 0) {
        return NextResponse.json({ error: "bad_index" }, { status: 400 });
      }
      const w = normalizeStillWidth(
        Number(url.searchParams.get("w") ?? thumbRaw ?? "400"),
      );
      const bytes = await readStillResized(key, file.id, file.storagePath, index, w);
      if (!bytes) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(bytes.length),
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (e) {
      if (e instanceof StillsUnavailableError) {
        return NextResponse.json(
          { error: "still_unavailable", reason: e.message },
          { status: 503 },
        );
      }
      throw e;
    }
  }

  if (wantThumb && isImage && file.mimeType !== "image/svg+xml") {
    const wRaw = Number(thumbRaw) || 200;
    const w =
      ALLOWED_THUMB_WIDTHS.find((n) => n >= wRaw) ??
      ALLOWED_THUMB_WIDTHS[ALLOWED_THUMB_WIDTHS.length - 1];
    const key = await clientKey();
    if (!key) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const client = { key };
    const ext = path.extname(file.storagePath) || ".jpg";
    const thumbRel = path.join(client.key, ".thumbs", `${file.id}-${w}${ext}`);
    const thumbAbs = resolveStoragePath(thumbRel);
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(thumbAbs);
    } catch {
      const src = await readFileBytes(file.storagePath);
      bytes = await sharp(src)
        .resize({ width: w, withoutEnlargement: true })
        .toBuffer();
      await fs.mkdir(path.dirname(thumbAbs), { recursive: true });
      await fs.writeFile(thumbAbs, bytes);
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mimeType ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // Full-resolution serve (also used for video, SVG, non-image originals).
  // Streamed with Range support: a <video> here has to be able to ask for the
  // head of the clip, and buffering the whole object to answer is what made a
  // video preview sit empty for as long as the file took to arrive.
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

  // Only a whole-file fetch counts as a download. A playing video issues a
  // string of Range requests, and counting each of them would turn one viewer
  // into dozens of "downloads".
  if (range.kind !== "range") {
    await db
      .update(shareGalleries)
      .set({ downloadCount: sql`${shareGalleries.downloadCount} + 1` })
      .where(eq(shareGalleries.id, id));
  }

  const headers: Record<string, string> = {
    "Content-Type": file.mimeType ?? "application/octet-stream",
    "Content-Length": String(stream.contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
  };
  if (range.kind === "range") {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
    return new NextResponse(stream.body, { status: 206, headers });
  }
  return new NextResponse(stream.body, { headers });
}
