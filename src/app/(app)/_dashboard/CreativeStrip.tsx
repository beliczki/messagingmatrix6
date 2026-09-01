"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import clsx from "clsx";

export type StripItem = {
  id: number;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  dimensions: string | null;
  mcLabel: string | null;
};

// Height-normalized album: every tile is 250px tall (h-[250px] on the media
// itself, so its width follows the aspect ratio) — a 300x250 banner sits next
// to a 1080x1080 square without cropping or letterboxing, the two just end up
// different widths. The height must NOT live on the anchor as a percentage the
// image resolves against: the anchor's own width is derived from the image.

export default function CreativeStrip({ items }: { items: StripItem[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    sync();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, items.length]);

  const step = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="creative-strip relative">
      <div
        ref={scrollerRef}
        onScroll={sync}
        className="creative-strip__scroller flex gap-2 overflow-x-auto scroll-smooth pb-2"
      >
        {items.map((it) => (
          <StripTile key={it.id} item={it} />
        ))}
      </div>
      <StepButton side="left" disabled={atStart} onClick={() => step(-1)} />
      <StepButton side="right" disabled={atEnd} onClick={() => step(1)} />
    </div>
  );
}

function StripTile({ item }: { item: StripItem }) {
  const isImage = item.mimeType?.startsWith("image/") ?? false;
  const isVideo = item.mimeType?.startsWith("video/") ?? false;
  const title = [item.mcLabel, item.fileName, item.dimensions]
    .filter(Boolean)
    .join(" · ");
  return (
    <a
      href={item.fileId ? `/api/files/${item.fileId}` : "/creative-library"}
      target={item.fileId ? "_blank" : undefined}
      rel="noreferrer"
      title={title}
      className="creative-strip__tile media-tile thumb-checker block shrink-0 overflow-hidden rounded-md border border-slate-200 transition hover:border-slate-400"
    >
      {isImage && item.fileId ? (
        <img
          src={`/api/files/${item.fileId}/thumbnail?w=400`}
          alt={item.fileName ?? "creative"}
          className="media-tile__image block h-[250px] w-auto"
          loading="lazy"
          decoding="async"
        />
      ) : isVideo && item.fileId ? (
        <video
          src={`/api/files/${item.fileId}#t=0.1`}
          className="media-tile__image block h-[250px] w-auto"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <div className="media-tile__placeholder flex h-[250px] w-[250px] items-center justify-center bg-slate-50 text-slate-300">
          <ImageIcon className="size-8" />
        </div>
      )}
    </a>
  );
}

function StepButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      className={clsx(
        "creative-strip__step toolbar-btn absolute top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white/90 text-slate-700 shadow-sm transition hover:bg-white",
        side === "left" ? "left-1" : "right-1",
        disabled && "pointer-events-none opacity-0",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
