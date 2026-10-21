import { NextResponse, type NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { shareGalleries } from "@/db/schema";
import { readFileBytes, readFileStream, resolveStoragePath } from "@/lib/storage";
import { parseRangeHeader } from "@/lib/http-range";
import { storedFileHeaders } from "@/lib/stored-file-headers";
import { loadSharedFile } from "@/lib/share-file";
import { isHtml5PackageFile } from "@/lib/html5-poster";
import { posterResponse } from "@/lib/html5-package-response";
import { isConvertibleImage, parseImageFormat, parseJpgQuality } from "@/lib/image-formats";
import { convertImage } from "@/lib/image-convert";
import {
  StillsUnavailableError,
  ensureStills,
  normalizeStillWidth,
  readStillResized,
  stillETag,
} from "@/lib/video-stills";

// Public file proxy used by the share viewer. The viewer is unauthenticated,
// so we cannot hit /api/files/{id}; access is gated on the file being listed in
// this share's snapshot (loadSharedFile).

type Params = { id: string; fileId: string };

const ALLOWED_THUMB_WIDTHS = [80, 200, 400, 800];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<Params> },
) {
  const { id, fileId } = await params;
  const shared = await loadSharedFile(id, fileId);
  if (!shared) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { file, clientKey: key } = shared;

  const url = new URL(req.url);
  const thumbRaw = url.searchParams.get("thumb");
  const wantThumb = thumbRaw !== null;
  const isImage = file.mimeType?.startsWith("image/") ?? false;
  const isVideo = file.mimeType?.startsWith("video/") ?? false;

  // A video's stills, same strip the signed-in library scrubs — the viewer here
  // is unauthenticated and cannot reach /api/files, so it comes through this
  // proxy instead. `?stills` is the manifest, `?still=N` one frame, and a
  // `?thumb=` on a video is frame 0, so the gallery's existing poster URL works
  // for video without the caller knowing the difference.
  // A package's thumbnail is its poster; the full-file serve below stays the
  // original zip, which is the share's download.
  if (wantThumb && isHtml5PackageFile(file)) {
    const wRaw = Number(thumbRaw) || 200;
    return posterResponse({
      req,
      clientKey: key,
      file,
      width:
        ALLOWED_THUMB_WIDTHS.find((n) => n >= wRaw) ??
        ALLOWED_THUMB_WIDTHS[ALLOWED_THUMB_WIDTHS.length - 1]!,
      cacheControl: "public, no-cache",
    });
  }

  if (isVideo && (wantThumb || url.searchParams.has("stills") || url.searchParams.has("still"))) {
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
      // The poster (`?thumb=` on a video) has no strip version in its URL — the
      // caller has not read the manifest yet. An ETag lets it revalidate rather
      // than survive a recut for a day and need a hard reload to come back.
      const tag = stillETag(file.id, index, w);
      if (req.headers.get("if-none-match") === tag) {
        return new NextResponse(null, { status: 304, headers: { ETag: tag } });
      }
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": String(bytes.length),
          ETag: tag,
          "Cache-Control": "public, no-cache",
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
        ...storedFileHeaders(file.mimeType),
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  // A download in another format (`?as=jpg&q=70`), from the download menus.
  // Converted on the fly and not cached: it is a one-off download, not a tile.
  const as = url.searchParams.get("as");
  if (as !== null) {
    const format = parseImageFormat(as);
    if (!format || !isConvertibleImage(file.mimeType)) {
      return NextResponse.json({ error: "not_convertible" }, { status: 400 });
    }
    let src: Buffer;
    try {
      src = await readFileBytes(file.storagePath);
    } catch {
      return NextResponse.json({ error: "storage_missing" }, { status: 410 });
    }
    const out = await convertImage(src, format, parseJpgQuality(url.searchParams.get("q")));
    await db
      .update(shareGalleries)
      .set({ downloadCount: sql`${shareGalleries.downloadCount} + 1` })
      .where(eq(shareGalleries.id, id));
    return new NextResponse(new Uint8Array(out.bytes), {
      headers: {
        ...storedFileHeaders(out.contentType),
        "Content-Length": String(out.bytes.length),
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
    ...storedFileHeaders(file.mimeType),
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
