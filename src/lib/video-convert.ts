import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileBytes } from "@/lib/storage";
import { stillCacheDir } from "@/lib/video-stills";
import type { VideoFormat } from "@/lib/video-formats";

const run = promisify(execFile);

// Re-encodes a shared video for a download in another format (user request,
// 2026-11-12: WebM next to the original MP4). Unlike a picture this is far too
// slow to redo per request — a 10 s 1080p clip took ~30 s on the live box
// (2 vCPU) — so each file is encoded once and cached on local disk beside its
// still strip; every later download is a file read.
//
// The route is public, so the cost has to be bounded by the share, not by the
// traffic: a file is encoded at most once (the cache, plus one pass shared by
// concurrent callers), one encode runs at a time per process, and it runs
// under `nice` so the app keeps answering while it does.

// Part of the cached file's NAME: a change to the settings below must miss and
// re-encode, not keep serving what the old ones produced.
const CACHE_VERSION = 1;

const ENCODERS: Record<VideoFormat, { args: string[]; contentType: string }> = {
  // Constant quality (fixed, no knob — user decision 2026-11-12). CRF 32 turned
  // the 6.2 MB 1080p test clip into 0.44 MB. yuv420p is what every browser and
  // player decodes; a 10-bit or 4:4:4 source would otherwise become a VP9
  // profile many of them refuse. Opus is WebM's audio; a silent clip has no
  // audio stream and the flag is simply unused.
  webm: {
    args: [
      "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0",
      "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
      "-pix_fmt", "yuv420p",
      "-c:a", "libopus", "-b:a", "96k",
    ],
    contentType: "video/webm",
  },
};

export class VideoConvertError extends Error {}

export function videoContentType(as: VideoFormat): string {
  return ENCODERS[as].contentType;
}

function convertedPath(clientKey: string, fileId: string, as: VideoFormat): string {
  return path.join(stillCacheDir(clientKey), `${fileId}-v${CACHE_VERSION}.${as}`);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// One encode at a time: each one already takes both cores.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const inFlight = new Map<string, Promise<string>>();

/** The video in `as`, encoded once and cached; returns the cached file's path. */
export async function ensureConvertedVideo(
  clientKey: string,
  fileId: string,
  storagePath: string,
  as: VideoFormat,
): Promise<string> {
  const out = convertedPath(clientKey, fileId, as);
  if (await exists(out)) return out;
  const existing = inFlight.get(out);
  if (existing) return existing;
  const job = oneAtATime(() => encode(storagePath, out, as)).finally(() =>
    inFlight.delete(out),
  );
  inFlight.set(out, job);
  return job;
}

async function encode(storagePath: string, out: string, as: VideoFormat): Promise<string> {
  // A caller that checked the cache just before an earlier pass finished
  // queued behind it; the file is there now.
  if (await exists(out)) return out;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-video-"));
  try {
    // ffmpeg needs a seekable file; in S3 mode the source is in the object store.
    const src = path.join(work, `src${path.extname(storagePath) || ".mp4"}`);
    await fs.writeFile(src, await readFileBytes(storagePath));
    const encoded = path.join(work, `out.${as}`);
    // -nostdin: ffmpeg otherwise reads its stdin as interactive commands.
    await run("nice", [
      "-n", "10",
      "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src,
      ...ENCODERS[as].args,
      encoded,
    ]);
    // Copy, then rename inside the cache dir: the work dir may be on another
    // filesystem (EXDEV, as in video-stills), and a reader must never find a
    // half-written file under the final name.
    await fs.mkdir(path.dirname(out), { recursive: true });
    const part = `${out}.part`;
    await fs.copyFile(encoded, part);
    await fs.rename(part, out);
    return out;
  } catch (e) {
    throw new VideoConvertError(`${as} encode failed: ${(e as Error).message}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
