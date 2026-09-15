// The SHAPE of a video's still strip, and the arithmetic over it. Kept free of
// node built-ins on purpose: `video-stills.ts` (ffmpeg, fs, sharp) is the
// server half, and the scrub in the browser needs the same rules to read a
// still index back as a timestamp. Importing the server half into a client
// component would drag sharp into the bundle.

// One still per SECOND (user, 2026-09-15 — the Frame.io reference). This is the
// TARGET spacing, not a guarantee: past MAX_STILLS the interval stretches so the
// strip still spans the whole clip rather than stopping partway through it. The
// cap is what keeps one long upload from writing thousands of JPEGs.
export const STILL_INTERVAL_SEC = 1;
export const MAX_STILLS = 60;

/** Seconds between stills for a clip of this length — 1s until the cap bites. */
export function stillInterval(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return STILL_INTERVAL_SEC;
  return Math.max(STILL_INTERVAL_SEC, Math.ceil(durationSec / MAX_STILLS));
}

// The first still is taken at 0.1s, not 0: the frame at exactly 0 is a black
// leader on most rendered ads. This is the same offset the old `#t=0.1` media
// fragment asked the browser for.
export const FIRST_STILL_OFFSET_SEC = 0.1;

// The clip's FINAL frame is always worth a still of its own (user, 2026-09-15):
// on an ad it is the branded CTA card, and the interval ticks miss it whenever
// the length is not a multiple of the interval — a 10s clip ticked at 0 and 5
// and stopped, so the end card never appeared in the scrub. Skipped when the
// last tick already sits within HALF an interval of the end, so the strip does
// not finish on two near-identical frames. Half, not a fixed second: at a 1s
// spacing a fixed second would swallow the closing frame of almost every clip.
export function endFrameMinGap(intervalSec: number): number {
  return intervalSec / 2;
}

// Bumped whenever the shape of a strip changes, so cached manifests written by
// an older rule are treated as a miss and regenerated. v2 = end frame appended,
// v3 = masters encoded by sharp from PNG (correct BT.709 colour) at 960px,
// v4 = one still per second instead of per five.
export const STILLS_CACHE_VERSION = 4;

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
  /** True when the LAST still is the clip's final frame, not an interval tick. */
  endFrame: boolean;
  version: number;
};

/** How many INTERVAL TICKS a clip of this length gets; the end frame is extra. */
export function planStills(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 1;
  const interval = stillInterval(durationSec);
  return Math.min(MAX_STILLS, Math.max(1, Math.ceil(durationSec / interval)));
}

/** Whether a clip of this length earns a closing still beyond its last tick. */
export function wantsEndFrame(durationSec: number, tickCount: number): boolean {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
  const interval = stillInterval(durationSec);
  const lastTick = FIRST_STILL_OFFSET_SEC + (tickCount - 1) * interval;
  return durationSec - lastTick >= endFrameMinGap(interval);
}

/** The timestamp a still index stands for, for the scrub's time readout. */
export function stillTimestamp(
  index: number,
  manifest: Pick<StillManifest, "count" | "intervalSec" | "durationSec" | "endFrame">,
): number {
  // The closing still is at the end of the clip, wherever that falls — reading
  // it off the interval would report a time the frame does not come from.
  if (manifest.endFrame && index === manifest.count - 1) return manifest.durationSec;
  return index * manifest.intervalSec;
}
