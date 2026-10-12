import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import type { UploadedFile } from "@/db/schema";
import {
  HTML5_PACKAGE_MIME,
  Html5PackageError,
  ensurePackageExtracted,
  packageEntryHeaders,
  resolvePackageEntry,
} from "./html5-package";
import { PosterUnavailableError, posterETag, readPosterResized } from "./html5-poster";

/**
 * One entry of an uploaded HTML5 package, for whichever route has already
 * decided the caller may see this file — the signed /pkg link or a share. The
 * routes differ only in that decision and in how long the answer may be cached;
 * everything about reading and sandboxing the entry is here.
 *
 * Frames point at `<base>/index.html`, never at the bare base: a relative
 * `img/bg.jpg` must resolve under the package, and a trailing-slash URL is
 * redirected away by Next before it gets here.
 */
export async function packageEntryResponse(opts: {
  clientKey: string;
  file: UploadedFile;
  relPath: string;
  cacheControl: string;
}): Promise<NextResponse> {
  const { clientKey, file, relPath, cacheControl } = opts;
  if (file.mimeType !== HTML5_PACKAGE_MIME) {
    return NextResponse.json({ error: "not_a_package" }, { status: 404 });
  }
  let dir: string;
  try {
    dir = await ensurePackageExtracted(clientKey, file.id, file.storagePath);
  } catch (e) {
    // Validated at upload, so a stored package that will not open is damage,
    // not input — say which, rather than a bare 500.
    if (e instanceof Html5PackageError) {
      return NextResponse.json({ error: "invalid_html5_package", code: e.code }, { status: 422 });
    }
    return NextResponse.json({ error: "storage_missing" }, { status: 410 });
  }
  const abs = await resolvePackageEntry(dir, relPath);
  if (!abs) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const bytes = await fs.readFile(abs);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      ...packageEntryHeaders(relPath),
      "Content-Length": String(bytes.length),
      "Cache-Control": cacheControl,
    },
  });
}

/**
 * A package's poster as a thumbnail response, for the two thumbnail routes (the
 * app's and the share's). Revalidated by ETag like a video's still 0, since the
 * URL that asks for it carries no poster version.
 */
export async function posterResponse(opts: {
  req: Request;
  clientKey: string;
  file: UploadedFile;
  width: number;
  cacheControl: string;
}): Promise<NextResponse> {
  const { req, clientKey, file, width, cacheControl } = opts;
  let bytes: Buffer;
  try {
    bytes = await readPosterResized(clientKey, file, width);
  } catch (e) {
    if (e instanceof PosterUnavailableError) {
      return NextResponse.json({ error: "poster_unavailable", reason: e.message }, { status: 503 });
    }
    throw e;
  }
  const tag = posterETag(file.id, width);
  if (req.headers.get("if-none-match") === tag) {
    return new NextResponse(null, { status: 304, headers: { ETag: tag } });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      ETag: tag,
      "Cache-Control": cacheControl,
    },
  });
}
