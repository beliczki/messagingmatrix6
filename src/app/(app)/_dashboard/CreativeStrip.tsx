"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { StripItem, StripPage } from "@/lib/dashboard-creatives";
import type { UploadedFile } from "../_components/MediaEntityDialog";
import { MatrixIframePreview } from "../_components/MatrixIframeTile";
import CreativeDetailDialog from "../creative-library/CreativeDetailDialog";
import MatrixDetailDialog from "../creative-library/MatrixDetailDialog";

// Height-normalized album: every tile is 250px tall (h-[250px] on the media
// itself, so its width follows the aspect ratio) — a 300x250 banner sits next
// to a 1080x1080 square without cropping or letterboxing, the two just end up
// different widths. The height must NOT live on the anchor as a percentage the
// image resolves against: the anchor's own width is derived from the image.

// Start fetching this far from the right edge, so the next tiles are usually
// already there by the time the scroll reaches them.
const LOAD_AHEAD_PX = 800;

type Props = {
  /** First page, rendered on the server so the strip is never empty on load. */
  page: StripPage;
  /** Day scope, echoed back to the API so paging stays inside the window. */
  scope: { d: string; r: string };
};

export default function CreativeStrip({ page, scope }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState<StripItem[]>(page.items);
  const [nextOffset, setNextOffset] = useState<number | null>(page.nextOffset);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [detailId, setDetailId] = useState<number | null>(null);
  // Scroll fires faster than React commits state, so two events can both see
  // an un-updated `nextOffset`/"not loading" and fetch the same page twice —
  // duplicate tiles, duplicate keys. Refs settle synchronously; the state
  // beside them only drives rendering.
  const cursor = useRef<number | null>(page.nextOffset);
  const inFlight = useRef(false);

  // A scope switch re-renders this component with a new first page; without
  // this the old window's tiles would stay on screen under the new heading.
  useEffect(() => {
    setItems(page.items);
    setNextOffset(page.nextOffset);
    cursor.current = page.nextOffset;
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [page]);

  const loadMore = useCallback(async () => {
    if (inFlight.current || cursor.current === null) return;
    inFlight.current = true;
    try {
      const r = await fetch(
        `/api/dashboard/creatives?d=${scope.d}&r=${scope.r}&offset=${cursor.current}`,
        { credentials: "include" },
      );
      if (!r.ok) {
        // Stop paging rather than retrying into the same failure on every
        // scroll event; what is already loaded stays usable.
        cursor.current = null;
        setNextOffset(null);
        return;
      }
      const next = (await r.json()) as StripPage;
      cursor.current = next.nextOffset;
      setItems((cur) => [...cur, ...next.items]);
      setNextOffset(next.nextOffset);
    } finally {
      inFlight.current = false;
    }
  }, [scope.d, scope.r]);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
    setAtEnd(remaining <= 1);
    if (remaining < LOAD_AHEAD_PX) void loadMore();
  }, [loadMore]);

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

  // The detail dialog is the Creative Library's own, so a creative opened from
  // the dashboard edits through exactly the same form and the same PATCH.
  const filesById = useMemo(() => {
    const m = new Map<string, UploadedFile>();
    for (const i of items) if (i.kind === "uploaded" && i.file) m.set(i.file.id, i.file);
    return m;
  }, [items]);
  const uploadedCreatives = useMemo(
    () => items.flatMap((i) => (i.kind === "uploaded" ? [i.creative] : [])),
    [items],
  );
  const open = detailId !== null ? items.find((i) => i.id === detailId) : undefined;

  return (
    <div className="creative-strip relative">
      <div
        ref={scrollerRef}
        onScroll={sync}
        className="creative-strip__scroller flex gap-2 overflow-x-auto overscroll-x-contain scroll-smooth pb-2"
      >
        {items.map((it) => (
          <StripTile key={it.id} item={it} onOpen={() => setDetailId(it.id)} />
        ))}
        {nextOffset !== null ? (
          <div className="creative-strip__loading flex h-[250px] w-[120px] shrink-0 items-center justify-center text-slate-300">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : null}
      </div>
      <StepButton side="left" disabled={atStart} onClick={() => step(-1)} />
      <StepButton
        side="right"
        disabled={atEnd && nextOffset === null}
        onClick={() => step(1)}
      />
      {open?.kind === "uploaded" ? (
        <CreativeDetailDialog
          creative={open.creative}
          creatives={uploadedCreatives}
          filesById={filesById}
          onJump={(id) => setDetailId(id)}
          onClose={() => setDetailId(null)}
        />
      ) : null}
      {open?.kind === "mc" ? (
        <MatrixDetailDialog
          item={{
            id: open.id,
            message: open.message,
            liveSize: open.size,
            liveTemplateName: open.template,
            product: open.product,
          }}
          navItems={items.flatMap((i) => (i.kind === "mc" ? [{ id: i.id }] : []))}
          onJump={(id) => setDetailId(id)}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </div>
  );
}

function StripTile({ item, onOpen }: { item: StripItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.kind === "uploaded" ? (item.creative.fileName ?? undefined) : item.mcLabel}
      className="creative-strip__tile media-tile thumb-checker group relative block shrink-0 overflow-hidden rounded-md border border-slate-200 transition hover:border-slate-400"
    >
      {item.kind === "mc" ? <McMedia item={item} /> : <UploadedMedia item={item} />}
      <span className="creative-strip__caption pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-slate-900/85 to-transparent px-2 pb-1.5 pt-6 text-left opacity-0 transition group-hover:opacity-100">
        <span className="creative-strip__caption-mc font-mono text-xs font-semibold text-white">
          {item.mcLabel ??
            (item.kind === "uploaded" ? (item.creative.fileName ?? "—") : "—")}
        </span>
        {item.topic ? (
          <span className="creative-strip__caption-topic truncate text-[10px] text-slate-200">
            {item.topic}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function UploadedMedia({ item }: { item: Extract<StripItem, { kind: "uploaded" }> }) {
  const { creative, file } = item;
  const isImage = file?.mimeType?.startsWith("image/") ?? false;
  const isVideo = file?.mimeType?.startsWith("video/") ?? false;
  if (isImage && creative.fileId) {
    return (
      <img
        src={`/api/files/${creative.fileId}/thumbnail?w=400`}
        alt={creative.fileName ?? "creative"}
        className="media-tile__image block h-[250px] w-auto"
        loading="lazy"
        decoding="async"
      />
    );
  }
  if (isVideo && creative.fileId) {
    return (
      <video
        src={`/api/files/${creative.fileId}#t=0.1`}
        className="media-tile__image block h-[250px] w-auto"
        preload="metadata"
        muted
        playsInline
      />
    );
  }
  return (
    <div className="media-tile__placeholder flex h-[250px] w-[250px] items-center justify-center bg-slate-50 text-slate-300">
      <ImageIcon className="size-8" />
    </div>
  );
}

// A DCO banner has no file to thumbnail — it is the template rendered with the
// cell's copy, the same live render the Creative Library grid shows, so an
// edit made a minute ago is on screen. The box is sized from the size token
// (a computed value, hence the inline width) and `fit-rect` scales the iframe
// into it.
function McMedia({ item }: { item: Extract<StripItem, { kind: "mc" }> }) {
  const m = item.size.match(/^(\d+)x(\d+)$/);
  const w = m ? parseInt(m[1]!, 10) : 300;
  const h = m ? parseInt(m[2]!, 10) : 250;
  return (
    <div
      className="creative-strip__mc h-[250px] bg-slate-100 dark:bg-black"
      style={{ width: Math.round((250 * w) / h) }}
    >
      <MatrixIframePreview
        message={item.message}
        templateName={item.template}
        size={item.size}
        mode="fit-rect"
      />
    </div>
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
