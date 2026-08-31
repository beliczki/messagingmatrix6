"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2 } from "lucide-react";

// Module-level cache shared across tile instances so tiles in different view
// modes (and remounted tiles after a filter toggle) reuse the same render.
const renderCache = new Map<string, string>();

function cacheKey(shareId: string, messageId: number, size: string) {
  return `${shareId}|${messageId}|${size}`;
}

function parseSize(size: string): { w: number; h: number } {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return { w: 300, h: 250 };
  return { w: parseInt(m[1]!, 10), h: parseInt(m[2]!, 10) };
}

type Props = {
  shareId: string;
  messageId: number;
  size: string;
  templateName?: string | null;
  /**
   * "fill-width": full-width container; height = aspect ratio (masonry).
   * "fit-rect": fits a fixed-size parent; letterboxed (card thumb).
   */
  mode: "fill-width" | "fit-rect";
};

export default function PublicMatrixPreview({
  shareId,
  messageId,
  size,
  templateName,
  mode,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(
    () => renderCache.get(cacheKey(shareId, messageId, size)) ?? null,
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      // LAST entry, not entries[0]. The callback receives every intersection
      // change queued since the previous delivery, oldest first, so during a
      // fast scroll `entries` is e.g. [leaving, entering] and entries[0] is a
      // stale `false`. Reading it pinned the tile at visible=false while it sat
      // still on screen — and a motionless tile produces no further intersection
      // change, so it stayed a `</>` placeholder forever.
      (entries) =>
        setVisible(entries[entries.length - 1]?.isIntersecting === true),
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || html !== null) return;
    const k = cacheKey(shareId, messageId, size);
    let cancelled = false;
    fetch("/api/render/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId, messageId, size, templateName }),
    })
      .then((r) => (r.ok ? r.text() : Promise.reject(r)))
      .then((text) => {
        // Cache before the cancelled check: the render arrived and is valid
        // whether or not this instance still wants it. Discarding it here meant
        // a tile that scrolled out mid-flight threw away work and refetched.
        renderCache.set(k, text);
        if (cancelled) return;
        setHtml(text);
      })
      .catch(() => {
        if (cancelled) return;
        setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, html, shareId, messageId, size, templateName]);

  const { w: nativeW, h: nativeH } = useMemo(() => parseSize(size), [size]);
  const scale =
    box.w > 0
      ? mode === "fill-width"
        ? Math.min(1, box.w / nativeW)
        : box.h > 0
          ? Math.min(1, box.w / nativeW, box.h / nativeH)
          : Math.min(1, box.w / nativeW)
      : 0;
  const scaledW = nativeW * scale;
  const scaledH = nativeH * scale;

  const wrapStyle: React.CSSProperties =
    mode === "fill-width" ? { aspectRatio: `${nativeW} / ${nativeH}` } : {};
  const wrapClass =
    mode === "fill-width"
      ? "matrix-iframe-preview thumb-checker relative w-full overflow-hidden"
      : "matrix-iframe-preview thumb-checker relative size-full overflow-hidden";

  return (
    <div ref={wrapRef} className={wrapClass} style={wrapStyle}>
      {visible && html !== null && html !== "" && scale > 0 ? (
        <>
          <iframe
            title={`Preview ${size}`}
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            className="matrix-iframe-preview__frame absolute block border-0"
            style={{
              width: nativeW,
              height: nativeH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              left: mode === "fit-rect" && box.w > 0 ? (box.w - scaledW) / 2 : 0,
              top: mode === "fit-rect" && box.h > 0 ? (box.h - scaledH) / 2 : 0,
            }}
          />
          <div
            className="matrix-iframe-preview__click-shield absolute inset-0 z-10"
            aria-hidden
          />
        </>
      ) : html === "" ? (
        <div className="matrix-iframe-preview__error flex size-full items-center justify-center text-[10px] text-rose-500">
          render failed
        </div>
      ) : (
        <div className="matrix-iframe-preview__placeholder flex size-full items-center justify-center text-slate-300">
          <Code2 className="size-6" />
        </div>
      )}
    </div>
  );
}
