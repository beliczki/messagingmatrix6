"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";

type StillManifest = { count: number; intervalSec: number; durationSec: number };

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
  scrub = true,
  compact = false,
}: {
  fileId: string;
  alt: string;
  imgClassName: string;
  wrapperClassName?: string;
  /** Requested poster width; the route rounds it up to a cached tier. */
  width: number;
  scrub?: boolean;
  /** Icon-only treatment for thumbnails too small to carry a caption. */
  compact?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [index, setIndex] = useState(0);
  const preloaded = useRef(false);

  const posterSrc = `/api/files/${fileId}/thumbnail?w=${width}`;

  // The masonry tile has no height of its own until the poster loads, so the
  // placeholder has to carry one; the fixed-size boxes (card, list row) just
  // fill theirs.
  const placeholderBox = clsx(
    "flex flex-col items-center justify-center gap-1.5 bg-slate-50 px-3 text-center text-slate-400",
    compact ? "size-full" : "aspect-[4/3] w-full",
  );

  // The strip is only worth knowing about once the pointer is on the box —
  // asking for every tile in the wall would generate stills nobody looks at.
  const stillsQ = useQuery<StillManifest>({
    queryKey: ["file-stills", fileId],
    enabled: scrub && hovering,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/files/${fileId}/still`);
      if (!res.ok) throw new Error(`stills ${res.status}`);
      return res.json();
    },
  });
  const manifest = stillsQ.data;
  const count = manifest?.count ?? 0;

  useEffect(() => {
    if (count < 2 || preloaded.current) return;
    preloaded.current = true;
    for (let i = 1; i < count; i += 1) {
      const img = new Image();
      img.src = `/api/files/${fileId}/still?i=${i}&w=${width}`;
    }
  }, [count, fileId, width]);

  // Still 0 keeps the poster URL so the resting frame stays the one the browser
  // already has; the scrub only introduces new URLs for the frames past it.
  const src = index === 0 ? posterSrc : `/api/files/${fileId}/still?i=${index}&w=${width}`;

  return (
    <div
      className={clsx("video-thumb relative", wrapperClassName)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        setIndex(0);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={clsx(imgClassName, !loaded && "absolute inset-0 opacity-0")}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />

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

      {/* The badge says "this is a video" at rest — the clip's length once the
          strip is known, and the scrub position while the pointer moves. The
          duration only arrives with the manifest, which is a hover away, so
          before that it is the icon alone rather than a made-up 0:00. */}
      {loaded && !compact ? (
        <span className="video-thumb__time pointer-events-none absolute bottom-1 right-1 flex items-center gap-1 rounded bg-slate-900/70 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          <Icon name="video" className="size-3" />
          {manifest
            ? formatClock(
                hovering && count > 1 ? index * manifest.intervalSec : manifest.durationSec,
              )
            : null}
        </span>
      ) : null}

      {/* One zone per still, laid over the poster — the same scrub the draft
          tiles use (DraftsView.tsx:677). Divs, not buttons: the card's own
          button is underneath and must keep taking the click. */}
      {scrub && loaded && count > 1 ? (
        <div className="video-thumb__scrub absolute inset-0 z-20 flex">
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              className="video-thumb__scrub-zone flex-1"
              onMouseEnter={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
