"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";

import { stillTimestamp, type StillManifest } from "@/lib/still-strip";

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A video's poster frame, with a hover scrub over the stills behind it.
 *
 * The poster comes from the thumbnail route (still 0) as a plain <img>, not a
 * <video preload="metadata">: a video element has to fetch and decode part of
 * the clip before it can paint anything, and until the stills exist there is
 * nothing to paint at all — which is what left the preview box empty after an
 * upload. So the box always says what it is doing instead of sitting blank.
 */
export default function VideoThumb({
  fileId,
  alt,
  imgClassName,
  wrapperClassName,
  width,
  shareId,
  scrub = true,
  compact = false,
}: {
  fileId: string;
  alt: string;
  imgClassName: string;
  wrapperClassName?: string;
  /** Requested poster width; the route rounds it up to a cached tier. */
  width: number;
  /** Set on the public share page: the viewer has no session, so the same
   *  stills come through the share's own file proxy instead of /api/files. */
  shareId?: string;
  scrub?: boolean;
  /** Icon-only treatment for thumbnails too small to carry a caption. */
  compact?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovering, setHovering] = useState(false);
  // `index` is where the POINTER is; `shown` is the frame actually on screen.
  // They differ while a frame is still downloading — a mounted <img> with no
  // bytes yet is transparent, so flipping it to opaque on mouseenter showed the
  // poster through it while the badge already claimed the new time.
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  // The frame the box was on before this one. It stays fully opaque UNDER the
  // incoming frame while that fades in — fading it out instead let the poster
  // show through the overlap, so every step of the scrub dissolved through
  // frame 0 on its way to the next one.
  const [under, setUnder] = useState(0);
  // Index 0 needs no waiting: it IS the poster, already on screen.
  const [ready, setReady] = useState<number[]>([0]);
  // Where the pointer last was across the box, 0–1. Continuous, unlike `index`:
  // the line tracks the mouse while the picture snaps to the nearest still.
  const [playhead, setPlayhead] = useState<number | null>(null);

  const base = shareId ? `/share/${shareId}/file/${fileId}` : `/api/files/${fileId}`;
  const posterSrc = shareId
    ? `${base}?thumb=${width}`
    : `${base}/thumbnail?w=${width}`;
  const manifestSrc = shareId ? `${base}?stills=1` : `${base}/still?manifest=1`;
  const frameUrl = (i: number, v: number) =>
    shareId
      ? `${base}?still=${i}&w=${width}&v=${v}`
      : `${base}/still?i=${i}&w=${width}&v=${v}`;

  // The masonry tile has no height of its own until the poster loads, so the
  // placeholder has to carry one; the fixed-size boxes (card, list row) just
  // fill theirs.
  const placeholderBox = clsx(
    "flex flex-col items-center justify-center gap-1.5 bg-slate-50 px-3 text-center text-slate-400",
    compact ? "size-full" : "aspect-[4/3] w-full",
  );

  // A plain fetch, not useQuery: this component also renders on the PUBLIC
  // share page, which has no QueryClientProvider — reaching for react-query
  // here took the whole share page down with a 500. One small JSON read needs
  // no cache layer anyway.
  //
  // It runs once the POSTER is up rather than on hover: serving that poster
  // already cut the strip server-side, so this is a disk read and never an
  // ffmpeg run. It has to be here rather than behind the pointer because the
  // badge reads "now / total" at rest, and the total comes from the manifest.
  const [manifest, setManifest] = useState<StillManifest | null>(null);
  useEffect(() => {
    if (!scrub || !loaded) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(manifestSrc);
      // No manifest means no strip to scrub — a video whose stills could not be
      // cut (no ffmpeg on the host) still has its poster, and keeps it.
      if (!res.ok || cancelled) return;
      setManifest((await res.json()) as StillManifest);
    })();
    return () => {
      cancelled = true;
    };
  }, [scrub, loaded, manifestSrc]);

  const count = manifest?.count ?? 0;
  // The strip's version rides in the URL so a regenerated strip is a new URL.
  // Without it the frames sit in the browser cache for a day and a redeploy
  // that recuts them — different colour, different frames — goes unseen.
  const version = manifest?.version ?? 0;
  const frameSrc = (i: number) => frameUrl(i, version);

  // The box holds the last frame it actually has until the next one arrives, so
  // a slow fetch never blanks it back to the poster mid-scrub.
  useEffect(() => {
    if (!ready.includes(index) || index === shown) return;
    setUnder(shown);
    setShown(index);
  }, [index, ready, shown]);

  return (
    <div
      className={clsx("video-thumb relative", wrapperClassName)}
      onMouseEnter={() => setHovering(true)}
      // Leaving does NOT rewind: the frame you stopped on is the one you wanted
      // to look at, so the box keeps it and the badge keeps its time.
      onMouseLeave={() => setHovering(false)}
    >
      {/* The poster is the base layer — it is what gives the masonry tile its
          height, so it stays mounted and keeps the box from collapsing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterSrc}
        alt={alt}
        className={clsx(imgClassName, !loaded && "absolute inset-0 opacity-0")}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />

      {/* The rest of the strip, stacked over the poster and cross-faded by
          opacity alone. They are mounted only while the pointer is on the box —
          every frame is already in the browser cache by then (preloaded above),
          so each fade starts from a decoded image and never flashes. Index 0
          fades them all out, which uncovers the poster underneath. */}
      {scrub && loaded && count > 1 && (hovering || shown > 0)
        ? Array.from({ length: count - 1 }, (_, n) => n + 1)
            // Only the frames around the pointer, plus the ones already
            // fetched. At one still per second a whole strip is tens of
            // megabytes, and mounting it all would pull every frame the moment
            // the pointer touched the box — this loads what you scrub over.
            .filter(
              (i) => i === shown || i === under || Math.abs(i - index) <= 2 || ready.includes(i),
            )
            .map((i) => {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={frameSrc(i)}
                alt=""
                aria-hidden
                className={clsx(
                  "video-thumb__frame absolute inset-0 size-full object-contain",
                  // The incoming frame fades in ON TOP; the outgoing one holds
                  // its opacity underneath rather than fading out, so nothing
                  // ever shows through the pair. Anything older fades out, but
                  // it does so hidden beneath them.
                  i === shown
                    ? "z-10 opacity-100 transition-opacity duration-200 ease-out"
                    : i === under
                      ? "z-0 opacity-100"
                      : "z-0 opacity-0 transition-opacity duration-200 ease-out",
                )}
                decoding="async"
                onLoad={() => setReady((r) => (r.includes(i) ? r : [...r, i]))}
              />
            );
          })
        : null}

      {!loaded && !failed ? (
        <div className={clsx(placeholderBox, "video-thumb__pending")}>
          <Icon name="video" className={compact ? "size-4" : "size-5 animate-pulse"} />
          {compact ? null : (
            <span className="text-[10px] leading-relaxed">
              Preparing the video preview —
              <br />
              stills are cut on first view.
            </span>
          )}
        </div>
      ) : null}

      {failed ? (
        <div className={clsx(placeholderBox, "video-thumb__failed")}>
          <Icon name="video" className={compact ? "size-4" : "size-5"} />
          {compact ? null : (
            <span className="text-[10px] leading-relaxed">
              No preview for this video.
            </span>
          )}
        </div>
      ) : null}

      {/* The scrub position, drawn over the picture (user, 2026-09-15 — the
          Frame.io reference). White at 50% inside a black 50% ring, so the line
          stays visible whether the frame under it is bright or dark. `left` is
          the one genuinely computed value here, so it has to be inline. */}
      {scrub && loaded && count > 1 && playhead !== null ? (
        <div
          className="video-thumb__playhead pointer-events-none absolute inset-y-0 z-30 w-px bg-white/50 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: `${playhead * 100}%` }}
        />
      ) : null}

      {/* The badge says WHICH MOMENT is in the box, over the clip's length —
          "0:00 / 0:10" at rest, following the pointer while scrubbing, and
          holding wherever it was left. Until the manifest lands there is no
          honest total to show, so it is the icon alone rather than a made-up one. */}
      {loaded && !compact ? (
        <span className="video-thumb__time pointer-events-none absolute bottom-1 right-1 flex items-center gap-1 rounded bg-slate-900/70 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          <Icon name="video" className="size-3" />
          {manifest
            ? `${formatClock(stillTimestamp(shown, manifest))} / ${formatClock(manifest.durationSec)}`
            : null}
        </span>
      ) : null}

      {/* One overlay tracking the pointer, rather than a row of zones: the line
          has to follow the mouse continuously while the picture snaps to the
          nearest still, and a zone can only report that it was entered. A div,
          not a button — the card's own button is underneath and must keep
          taking the click. */}
      {scrub && loaded && count > 1 ? (
        <div
          className="video-thumb__scrub absolute inset-0 z-20"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            if (r.width === 0) return;
            const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
            setPlayhead(pct);
            setIndex(Math.min(count - 1, Math.floor(pct * count)));
          }}
        />
      ) : null}
    </div>
  );
}
