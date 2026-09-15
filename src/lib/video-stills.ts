import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { readFileBytes, resolveStoragePath } from "@/lib/storage";

const run = promisify(execFile);

// One still every 5 seconds (user, 2026-09-15). The cap covers the first five
// minutes — ad creatives are 6–60s, so it only ever bites on a stray long file,
// and it keeps one bad upload from writing 2000 JPEGs into the cache.
export const STILL_INTERVAL_SEC = 5;
export const MAX_STILLS = 60;

// The first still is taken at 0.1s, not 0: the frame at exactly 0 is a black
// leader on most rendered ads. This is the same offset the old `#t=0.1` media
// fragment asked the browser for.
const FIRST_STILL_OFFSET_SEC = 0.1;

// Two ffmpeg passes at a time. A masonry wall of unseen videos would otherwise
// start one decode per tile the moment the page paints.
const MAX_CONCURRENT_FFMPEG = 2;

// The width tiers a still is cached at. Owned here because they are part of
// the still cache's file names — an ad-hoc width would write a new JPEG per
// pixel value the UI happens to ask for.
export const STILL_WIDTHS = [80, 200, 400, 800];

export function normalizeStillWidth(raw: number): number {
  if (!Number.isFinite(raw)) return STILL_WIDTHS[1];
  return STILL_WIDTHS.find((n) => n >= raw) ?? STILL_WIDTHS[STILL_WIDTHS.length - 1];
}

export type StillManifest = {
  /** How many stills actually exist, `{id}-still-0.jpg` … `-{count-1}.jpg`. */
  count: number;
  intervalSec: number;
  durationSec: number;
};

export class StillsUnavailableError extends Error {}

/** How many stills a clip of this length gets. Pure — the cap lives here. */
export function planStills(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 1;
  return Math.min(MAX_STILLS, Math.max(1, Math.ceil(durationSec / STILL_INTERVAL_SEC)));
}

/** The timestamp a still index stands for, for the scrub's time readout. */
export function stillTimestamp(index: number): number {
  return index * STILL_INTERVAL_SEC;
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
    return JSON.parse(raw) as StillManifest;
  } catch {
    return null;
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

    // `select`, not `fps=1/5`: the fps filter needs a full 5s slot to emit a
    // frame, so a 17s clip loses its tail and yields 3 stills instead of 4.
    // This expression takes the first frame, then one every 5s of elapsed
    // source time. `-fps_mode passthrough` is what stops ffmpeg from padding
    // the gaps back out to the source framerate (without it: 60 stills).
    await run("ffmpeg", [
      "-v",
      "error",
      "-ss",
      String(FIRST_STILL_OFFSET_SEC),
      "-i",
      src,
      "-vf",
      `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${STILL_INTERVAL_SEC})',scale=640:-2`,
      "-fps_mode",
      "passthrough",
      "-frames:v",
      String(cap),
      "-q:v",
      "4",
      path.join(work, "still-%03d.jpg"),
    ]);

    // ffmpeg numbers from 1 and may produce FEWER than the cap when the last
    // interval falls past the end of the clip — what actually landed on disk is
    // the count the manifest reports, not what we planned for.
    const produced = (await fs.readdir(work))
      .filter((f) => f.startsWith("still-") && f.endsWith(".jpg"))
      .sort();
    if (produced.length === 0) {
      throw new StillsUnavailableError(`ffmpeg produced no stills for ${fileId}`);
    }

    // copyFile, not rename: STORAGE_ROOT is a config knob and may well point at
    // a different filesystem than os.tmpdir() — on the live box the cache sits
    // on a mounted volume while the work dir is on the root disk, and a rename
    // across that boundary fails with EXDEV. The work dir is removed either way
    // by the finally below.
    for (const [i, name] of produced.entries()) {
      await fs.copyFile(path.join(work, name), stillPath(clientKey, fileId, i));
    }

    const manifest: StillManifest = {
      count: produced.length,
      intervalSec: STILL_INTERVAL_SEC,
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
  const sized = path.join(
    stillCacheDir(clientKey),
    `${fileId}-still-${index}-${width}.jpg`,
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
    .jpeg({ quality: 82 })
    .toBuffer();
  await fs.writeFile(sized, bytes);
  return bytes;
}
