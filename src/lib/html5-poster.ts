// The poster of an uploaded HTML5 package: one frame, shot in headless Chromium
// from the package's signed /pkg link, cached on local disk beside the image
// thumbnails and video stills. It is what stands in for the package wherever a
// live iframe is not used — the thumbnail every surface already asks for
// (/api/files/[id]/thumbnail, the share's ?thumb=), so a draft cover or a
// share picker shows the banner instead of a broken image.
//
// Regenerable like the stills: the bytes of a file id never change, so a
// poster is shot once; bump POSTER_CACHE_VERSION to reshoot under a new rule.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { UploadedFile } from "@/db/schema";
import { HTML5_PACKAGE_MIME } from "./html5-package";
import { defaultBaseUrl, shootUrl } from "./preview-shooter";
import { signPackageToken } from "./public-shortcut";
import { resolveStoragePath } from "./storage";

const POSTER_CACHE_VERSION = 1;
const DERIVATIVE_JPEG = { quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;

/** No poster can be made — the package has no known size, or no browser runs here. */
export class PosterUnavailableError extends Error {}

function thumbsDir(clientKey: string): string {
  return resolveStoragePath(path.join(clientKey, ".thumbs"));
}

function masterPath(clientKey: string, fileId: string): string {
  return path.join(thumbsDir(clientKey), `${fileId}-poster-v${POSTER_CACHE_VERSION}.png`);
}

export function isHtml5PackageFile(file: Pick<UploadedFile, "mimeType">): boolean {
  return file.mimeType === HTML5_PACKAGE_MIME;
}

const inFlight = new Map<string, Promise<string>>();

async function ensurePoster(clientKey: string, file: UploadedFile): Promise<string> {
  const master = masterPath(clientKey, file.id);
  try {
    await fs.access(master);
    return master;
  } catch {
    // not shot yet
  }
  const key = `${clientKey}/${file.id}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const job = (async () => {
    try {
      const [w, h] = (file.dimensions ?? "").split("x").map(Number);
      if (!w || !h) {
        throw new PosterUnavailableError("the package has no known size to frame");
      }
      const token = await signPackageToken(file.id);
      let png: Buffer;
      try {
        png = await shootUrl(`${defaultBaseUrl()}/pkg/${encodeURIComponent(token)}/index.html`, w, h);
      } catch (e) {
        // Missing Chromium, or a package that never loads: say so as
        // "unavailable" (503), the same way a missing ffmpeg is for stills.
        throw new PosterUnavailableError((e as Error).message);
      }
      await fs.mkdir(path.dirname(master), { recursive: true });
      await fs.writeFile(master, png);
      return master;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

/** The poster at `width`, cut once per width from the master, like a thumbnail. */
export async function readPosterResized(
  clientKey: string,
  file: UploadedFile,
  width: number,
): Promise<Buffer> {
  const sized = path.join(
    thumbsDir(clientKey),
    `${file.id}-poster-v${POSTER_CACHE_VERSION}-${width}.jpg`,
  );
  try {
    return await fs.readFile(sized);
  } catch {
    // not cut at this width yet
  }
  const master = await ensurePoster(clientKey, file);
  const bytes = await sharp(master)
    .resize({ width, withoutEnlargement: true })
    .jpeg(DERIVATIVE_JPEG)
    .toBuffer();
  await fs.writeFile(sized, bytes);
  return bytes;
}

/** Identifies a poster's bytes, so a reshoot under a new version revalidates. */
export function posterETag(fileId: string, width: number): string {
  return `"p${POSTER_CACHE_VERSION}-${fileId}-${width}"`;
}
