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
// 2026-11-12: WebM next to the original MP4). Unlike a picture this is too
// slow to redo per request — a 10 s 1080p clip takes several seconds to a
// minute on the live box (2 vCPU), depending on the picture — so each file is
// encoded once and cached on local disk beside its still strip; every later
// download is a file read.
//
// The route is public, so the cost has a ceiling per input and per process
// (Chief Architect review, 2026-11-12), not just per share:
// - a file is encoded at most once: the cache, plus one pass shared by
//   concurrent callers for it;
// - only what fits the caps below is encoded at all, and an encode that runs
//   past encodeTimeoutMs is killed;
// - one encode runs at a time per process, at most MAX_WAITING wait behind it,
//   and the rest are turned away to come back later;
// - it runs under `nice`, so the app keeps answering meanwhile.

// Part of the cached file's NAME: a change to the settings below must miss and
// re-encode, not keep serving what the old ones produced — nor keep refusing
// a clip the old, slower settings ran out of time on. 2 = realtime VP9.
const CACHE_VERSION = 2;

// The caps. A banner video is seconds long and at most 1080p. The timeout
// stays inside nginx's 300 s; at the slowest rate measured (~2 s of encode per
// second of a busy 1080p clip, realtime settings) 60 s of video fits in it,
// and anything heavier is stopped and remembered (markOverCap).
export const MAX_SOURCE_BYTES = 150 * 1024 * 1024;
export const MAX_DURATION_SEC = 60;
export const MAX_PIXELS = 1920 * 1080;
let encodeTimeoutMs = 240_000;
/** Tests only: a timeout short enough to trip on purpose. */
export function _setEncodeTimeoutForTests(ms: number) {
  encodeTimeoutMs = ms;
}
const MAX_WAITING = 2;

const ENCODERS: Record<VideoFormat, { args: string[]; contentType: string }> = {
  // Constant quality (fixed, no knob — user decision 2026-11-12), CRF 32.
  // `realtime` / `cpu-used 6`, measured on the box against the 10 s 1080x1920
  // Telekom clip the first deploy took 110 s on: `good`/4 99 s, 2.9 MB, SSIM
  // 0.9811; `good`/5 92 s; `realtime`/6 19 s, 3.7 MB, SSIM 0.9817; `realtime`/8
  // 14 s, 4.1 MB, SSIM 0.9815. Same picture quality at a fifth of the time, for
  // a quarter more bytes. yuv420p is what every browser and player decodes; a
  // 10-bit or 4:4:4 source would otherwise become a VP9 profile many of them
  // refuse. Opus is WebM's audio; a silent clip has no audio stream and the
  // flag is simply unused.
  webm: {
    args: [
      "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0",
      "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "6",
      "-threads", "2", "-pix_fmt", "yuv420p",
      "-c:a", "libopus", "-b:a", "96k",
    ],
    contentType: "video/webm",
  },
};

/** The encode failed or could not run (ffmpeg missing, killed, bad input). */
export class VideoConvertError extends Error {}
/** The video is over a cap; the original is the way to get it. */
export class VideoTooLargeError extends Error {}
/** Too many encodes already waiting in this process; try again later. */
export class VideoBusyError extends Error {}

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

// One encode at a time: each one already takes both cores. `waiting` counts
// the jobs queued behind the running one.
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) {
    throw new VideoBusyError(`${waiting} encodes already waiting`);
  }
  waiting += 1;
  const start = () => {
    waiting -= 1;
    return work();
  };
  const next = queue.then(start, start);
  queue = next.catch(() => undefined);
  return next;
}
export const _oneAtATimeForTests = oneAtATime;

const inFlight = new Map<string, Promise<string>>();

// A refusal is remembered on disk next to where the WebM would be, so asking
// again (also after a restart) answers at once instead of pulling the source
// down, probing it, or burning another 240 s of both cores on it.
// - `.over`: over a cap. Size, length and resolution are the file's own, so
//   this one stands until a CACHE_VERSION bump.
// - `.timeout`: the encode ran past the timeout. Encode time depends on the
//   picture (a 10 s clip took 30 s on one share, 110 s on another) but also
//   on what else the 2-vCPU box is doing, so this one is retried after a day
//   (Chief Architect review, 2026-11-12) rather than condemning the clip for
//   one busy moment.
type Refusal = "over" | "timeout";
const TIMEOUT_RETRY_MS = 24 * 60 * 60 * 1000;

function refusalMarker(out: string, kind: Refusal): string {
  return `${out}.${kind}`;
}

/** A missing marker is the ordinary case — the file was never refused. */
async function readMarker(file: string): Promise<{ reason: string; ageMs: number } | null> {
  let reason: string;
  let mtimeMs: number;
  try {
    [reason, { mtimeMs }] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch {
    return null;
  }
  return { reason, ageMs: Date.now() - mtimeMs };
}

async function readRefusal(out: string): Promise<string | null> {
  const over = await readMarker(refusalMarker(out, "over"));
  if (over) return over.reason;
  const timeout = await readMarker(refusalMarker(out, "timeout"));
  if (timeout && timeout.ageMs < TIMEOUT_RETRY_MS) return timeout.reason;
  return null;
}

async function markRefused(out: string, kind: Refusal, reason: string): Promise<VideoTooLargeError> {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(refusalMarker(out, kind), reason, "utf8");
  return new VideoTooLargeError(reason);
}
export const _timeoutRetryMsForTests = TIMEOUT_RETRY_MS;

/** The video in `as`, encoded once and cached; returns the cached file's path. */
export async function ensureConvertedVideo(
  clientKey: string,
  file: { id: string; storagePath: string; sizeBytes: number | null },
  as: VideoFormat,
): Promise<string> {
  const out = convertedPath(clientKey, file.id, as);
  if (await exists(out)) return out;
  const known = await readRefusal(out);
  if (known !== null) throw new VideoTooLargeError(known);
  if (file.sizeBytes !== null && file.sizeBytes > MAX_SOURCE_BYTES) {
    throw new VideoTooLargeError(`source is ${file.sizeBytes} bytes, over ${MAX_SOURCE_BYTES}`);
  }
  const existing = inFlight.get(out);
  if (existing) return existing;
  const job = oneAtATime(() => encode(file, out, as)).finally(() => inFlight.delete(out));
  inFlight.set(out, job);
  return job;
}

async function probe(src: string): Promise<{ width: number; height: number; durationSec: number }> {
  const { stdout } = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height:format=duration",
    "-of", "json", src,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams: Array<{ width: number; height: number }>;
    format: { duration?: string };
  };
  const stream = parsed.streams[0];
  if (!stream) throw new VideoConvertError("no video stream");
  return {
    width: stream.width,
    height: stream.height,
    durationSec: Number(parsed.format.duration),
  };
}

async function encode(
  file: { id: string; storagePath: string },
  out: string,
  as: VideoFormat,
): Promise<string> {
  // A caller that checked the cache just before an earlier pass finished
  // queued behind it; the file is there now.
  if (await exists(out)) return out;
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-video-"));
  try {
    // ffmpeg needs a seekable file; in S3 mode the source is in the object store.
    const src = path.join(work, `src${path.extname(file.storagePath) || ".mp4"}`);
    const bytes = await readFileBytes(file.storagePath);
    await fs.writeFile(src, bytes);

    const { width, height, durationSec } = await probe(src);
    // A duration ffprobe cannot read is let through: the timeout still bounds it.
    const over =
      width * height > MAX_PIXELS
        ? `${width}x${height} is over 1080p`
        : durationSec > MAX_DURATION_SEC
          ? `${durationSec.toFixed(1)} s is over ${MAX_DURATION_SEC} s`
          : null;
    if (over) throw await markRefused(out, "over", over);

    const encoded = path.join(work, `out.${as}`);
    const started = Date.now();
    // -nostdin: ffmpeg otherwise reads its stdin as interactive commands.
    // `nice` execs ffmpeg in place, so the timeout's SIGKILL reaches ffmpeg.
    try {
      await run(
        "nice",
        [
          "-n", "10",
          "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src,
          ...ENCODERS[as].args,
          encoded,
        ],
        { timeout: encodeTimeoutMs, killSignal: "SIGKILL" },
      );
    } catch (e) {
      // Killed by OUR timeout: execFile sets `killed` only when it killed the
      // child itself. A SIGKILL from elsewhere (the kernel's OOM killer) or an
      // ffmpeg crash is not the clip's fault and is not remembered.
      const { killed, signal } = e as { killed?: boolean; signal?: string };
      if (killed && signal === "SIGKILL") {
        throw await markRefused(
          out,
          "timeout",
          `encode ran past ${encodeTimeoutMs / 1000} s (${width}x${height}, ${durationSec.toFixed(1)} s)`,
        );
      }
      throw e;
    }
    // Copy, then rename inside the cache dir: the work dir may be on another
    // filesystem (EXDEV, as in video-stills), and a reader must never find a
    // half-written file under the final name.
    await fs.mkdir(path.dirname(out), { recursive: true });
    const part = `${out}.part`;
    await fs.copyFile(encoded, part);
    await fs.rename(part, out);
    const { size } = await fs.stat(out);
    // One line per encode, so heavy or unexpected use shows in the pm2 log.
    console.log(
      `[video-convert] ${file.id} ${as} ${width}x${height} ${durationSec.toFixed(1)}s ` +
        `${Date.now() - started}ms in=${bytes.length} out=${size}`,
    );
    return out;
  } catch (e) {
    if (e instanceof VideoTooLargeError || e instanceof VideoConvertError) throw e;
    // Not remembered (it may be the box, not the clip), so it is logged.
    const failure = new VideoConvertError(`${as} encode failed for ${file.id}: ${(e as Error).message}`);
    console.error(`[video-convert] ${failure.message}`);
    throw failure;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
