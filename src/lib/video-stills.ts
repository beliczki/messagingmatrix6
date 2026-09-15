import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { readFileBytes, resolveStoragePath } from "@/lib/storage";
import {
  FIRST_STILL_OFFSET_SEC,
  STILLS_CACHE_VERSION,
  STILL_INTERVAL_SEC,
  planStills,
  stillInterval,
  wantsEndFrame,
  type StillManifest,
} from "@/lib/still-strip";

export {
  MAX_STILLS,
  STILL_INTERVAL_SEC,
  STILL_WIDTHS,
  normalizeStillWidth,
  planStills,
  stillInterval,
  stillTimestamp,
  wantsEndFrame,
  type StillManifest,
} from "@/lib/still-strip";

const run = promisify(execFile);

// The master every cached width is derived from. Half what it was (user,
// 2026-09-15 — "half resolution is enough, it'll be faster"): the tiles ask for
// the 400 tier now, so 480 still leaves the widest served width a real
// downscale. It also quarters the pixels through ffmpeg and sharp, which is
// most of what makes a first view slow, and quarters what the cache holds.
const STILL_MASTER_WIDTH = 480;

// ffmpeg hands over LOSSLESS PNG and sharp does every JPEG encode. ffmpeg's
// mjpeg encoder writes YCbCr with the BT.601 matrix JPEG is defined around, but
// does not convert a BT.709 source into it — a solid Telekom magenta came back
// rgb(206,0,109) instead of rgb(222,0,111), visibly duller, at EVERY quality
// setting. Going through RGB removes the mismatch and the double encode with it.
const MASTER_JPEG = { quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;
const DERIVATIVE_JPEG = { quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;

// Two ffmpeg passes at a time. A masonry wall of unseen videos would otherwise
// start one decode per tile the moment the page paints.
const MAX_CONCURRENT_FFMPEG = 2;

export class StillsUnavailableError extends Error {}

/**
 * Identifies one still's BYTES. The strip version is in it, so a recut changes
 * the tag and a browser holding the old frame revalidates its way to the new
 * one instead of sitting on it until the cache expires.
 */
export function stillETag(fileId: string, index: number, width: number): string {
  return `"s${STILLS_CACHE_VERSION}-${fileId}-${index}-${width}"`;
}

export function stillCacheDir(clientKey: string): string {
  return resolveStoragePath(path.join(clientKey, ".thumbs"));
}

export function stillPath(clientKey: string, fileId: string, index: number): string {
  return path.join(stillCacheDir(clientKey), `${fileId}-still-${index}.jpg`);
}

function manifestPath(clientKey: string, fileId: string): string {
  return path.join(stillCacheDir(clientKey), `${fileId}-stills.json`);
}

const inFlight = new Map<string, Promise<StillManifest>>();
let running = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT_FFMPEG) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
}

function release(): void {
  running -= 1;
  const next = waiting.shift();
  if (next) next();
}

async function readManifest(
  clientKey: string,
  fileId: string,
): Promise<StillManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath(clientKey, fileId), "utf8");
    const parsed = JSON.parse(raw) as StillManifest;
    // A strip cut under an older rule is a miss, not a hit — regenerate it.
    if (parsed.version !== STILLS_CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    file,
  ]);
  const n = Number(stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

async function generate(
  clientKey: string,
  fileId: string,
  storagePath: string,
): Promise<StillManifest> {
  const cacheDir = stillCacheDir(clientKey);
  await fs.mkdir(cacheDir, { recursive: true });

  const work = await fs.mkdtemp(path.join(os.tmpdir(), `mm6-stills-${fileId}-`));
  try {
    // ffmpeg needs a seekable file; in S3 mode the source lives in the object
    // store, so it comes down once for the whole strip — not once per still.
    const src = path.join(work, `src${path.extname(storagePath) || ".mp4"}`);
    await fs.writeFile(src, await readFileBytes(storagePath));

    const durationSec = await probeDuration(src);
    const cap = planStills(durationSec);
    const intervalSec = stillInterval(durationSec);

    // `select`, not `fps=1/N`: the fps filter needs a full slot to emit a
    // frame, so a clip whose length is not a multiple of the interval loses its
    // tail. This expression takes the first frame, then one every interval of
    // elapsed source time. `-fps_mode passthrough` is what stops ffmpeg from
    // padding the gaps back out to the source framerate.
    await run("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(FIRST_STILL_OFFSET_SEC),
      "-i",
      src,
      "-vf",
      `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${intervalSec})',scale=${STILL_MASTER_WIDTH}:-2`,
      "-fps_mode",
      "passthrough",
      "-frames:v",
      String(cap),
      path.join(work, "still-%03d.png"),
    ]);

    // ffmpeg numbers from 1 and may produce FEWER than the cap when the last
    // interval falls past the end of the clip — what actually landed on disk is
    // the count the manifest reports, not what we planned for.
    const produced = (await fs.readdir(work))
      .filter((f) => f.startsWith("still-") && f.endsWith(".png"))
      .sort();
    if (produced.length === 0) {
      throw new StillsUnavailableError(`ffmpeg produced no stills for ${fileId}`);
    }

    // The closing frame, seeked from the END of the file rather than by
    // timestamp, so it lands on the last decodable frame whatever the duration
    // rounds to. Appended after the sort, so it is always the highest index.
    let endFrame = false;
    if (wantsEndFrame(durationSec, produced.length)) {
      const endName = "end.png";
      await run("ffmpeg", [
        "-v",
        "error",
        "-sseof",
        "-0.5",
        "-i",
        src,
        "-vf",
        `scale=${STILL_MASTER_WIDTH}:-2`,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-y",
        path.join(work, endName),
      ]);
      // A container ffmpeg cannot seek backwards from EOF exits 0 having
      // written nothing. The ticks are a usable strip on their own, so fall
      // back to them rather than losing the poster over a missing end card.
      if (await exists(path.join(work, endName))) {
        produced.push(endName);
        endFrame = true;
      }
    }

    // sharp encodes the masters out of the PNGs. This also sidesteps EXDEV:
    // STORAGE_ROOT is a config knob and may sit on a different filesystem than
    // os.tmpdir() — on the live box the cache is on a mounted volume while the
    // work dir is on the root disk. The work dir goes either way in the finally.
    for (const [i, name] of produced.entries()) {
      await sharp(path.join(work, name))
        .jpeg(MASTER_JPEG)
        .toFile(stillPath(clientKey, fileId, i));
    }

    const manifest: StillManifest = {
      count: produced.length,
      endFrame,
      version: STILLS_CACHE_VERSION,
      intervalSec,
      durationSec,
    };
    await fs.writeFile(
      manifestPath(clientKey, fileId),
      JSON.stringify(manifest),
      "utf8",
    );
    return manifest;
  } catch (e) {
    if (e instanceof StillsUnavailableError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new StillsUnavailableError(
        "ffmpeg/ffprobe is not installed on this host",
      );
    }
    throw new StillsUnavailableError(
      `still extraction failed for ${fileId}: ${(e as Error).message}`,
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/**
 * Cut the strips for these videos now, so that the first person to open a share
 * is not the one who pays for them. The strips are a SHARED on-disk cache, not
 * per-viewer work — but somebody has to be first, and without this it is
 * whoever the link was sent to.
 *
 * Best effort by design: a file whose strip cannot be cut must not take the
 * share down with it, so each failure is logged and skipped. The two-at-a-time
 * gate inside ensureStills is what keeps a large share from flooding the box.
 */
export async function warmStills(
  clientKey: string,
  files: Array<{ id: string; storagePath: string; mimeType: string | null }>,
): Promise<void> {
  const videos = files.filter((f) => f.mimeType?.startsWith("video/"));
  await Promise.all(
    videos.map(async (f) => {
      try {
        await ensureStills(clientKey, f.id, f.storagePath);
      } catch (e) {
        console.error(
          `[stills] warm failed for ${f.id}: ${(e as Error).message}`,
        );
      }
    }),
  );
}

/**
 * The still strip for a video, generated once and cached on local disk beside
 * the image thumbnails. Concurrent callers for the same file share one pass.
 */
export async function ensureStills(
  clientKey: string,
  fileId: string,
  storagePath: string,
): Promise<StillManifest> {
  const cached = await readManifest(clientKey, fileId);
  if (cached) return cached;

  const key = `${clientKey}/${fileId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const job = (async () => {
    await acquire();
    try {
      return await generate(clientKey, fileId, storagePath);
    } finally {
      release();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

/**
 * One still, resized to `width` and cached at that width — the same
 * generate-once-on-miss contract the image thumbnails have. Returns null when
 * the index is past the end of the strip.
 */
export async function readStillResized(
  clientKey: string,
  fileId: string,
  storagePath: string,
  index: number,
  width: number,
): Promise<Buffer | null> {
  // The cache version is part of the NAME, not just the manifest: the manifest
  // check below only guards the masters, and a derivative cut from an older
  // master would otherwise be served forever — stale colour, stale size, with
  // nothing to notice it. A bump simply misses and rebuilds.
  const sized = path.join(
    stillCacheDir(clientKey),
    `${fileId}-still-${index}-${width}-v${STILLS_CACHE_VERSION}.jpg`,
  );
  try {
    return await fs.readFile(sized);
  } catch {
    // Not cached at this width yet — fall through and build it.
  }

  const manifest = await ensureStills(clientKey, fileId, storagePath);
  if (index < 0 || index >= manifest.count) return null;

  const bytes = await sharp(stillPath(clientKey, fileId, index))
    .resize({ width, withoutEnlargement: true })
    .jpeg(DERIVATIVE_JPEG)
    .toBuffer();
  await fs.writeFile(sized, bytes);
  return bytes;
}
