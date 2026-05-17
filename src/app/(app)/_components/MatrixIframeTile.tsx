"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2 } from "lucide-react";
import type { Message } from "../matrix/types";
import { LIST_GRID_TEMPLATE, formatListDate } from "./ListSortHeader";

// Module-level cache: many tiles share the same render result if shown twice
// in the same session (e.g. after filter toggles). Keyed by message version
// so edits in another tab show up as soon as React Query revalidates.
const renderCache = new Map<string, string>();

function cacheKey(msgId: number, version: number, templateName: string, size: string) {
  return `${msgId}|v${version}|${templateName}|${size}`;
}

function parseSize(size: string): { w: number; h: number } {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return { w: 300, h: 250 };
  return { w: parseInt(m[1]!, 10), h: parseInt(m[2]!, 10) };
}

// ── Live iframe preview that lazy-mounts when scrolled into view ──
// Two layout modes:
//   "fill-width" (masonry): wrapper takes full width and uses the banner's
//     aspect-ratio for natural height; iframe scales to width.
//   "fit-rect" (card thumb / list thumb): wrapper fills its fixed-size parent
//     (size-full), iframe scales to fit both axes (letterboxed).
function MatrixIframePreview({
  message,
  templateName,
  size,
  mode,
}: {
  message: Message;
  templateName: string;
  size: string;
  mode: "fill-width" | "fit-rect";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [visible, setVisible] = useState(false);

  const initial = renderCache.get(
    cacheKey(message.id, message.version, templateName, size),
  );
  const [html, setHtml] = useState<string | null>(initial ?? null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const isIn = entries[0]?.isIntersecting === true;
        setVisible(isIn);
      },
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
    const k = cacheKey(message.id, message.version, templateName, size);
    let cancelled = false;
    fetch("/api/render", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName,
        size,
        message,
        inline: true,
        skipAnimations: false,
      }),
    })
      .then(async (r) => {
        if (r.ok) return r.text();
        const detail = await r.text().catch(() => "");
        return Promise.reject({ status: r.status, statusText: r.statusText, detail });
      })
      .then((text) => {
        if (cancelled) return;
        renderCache.set(k, text);
        setHtml(text);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[MatrixIframePreview] render failed", {
          messageId: message.id,
          version: message.version,
          templateName,
          size,
          err,
        });
        setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [visible, html, message.id, message.version, templateName, size]);

  function retry() {
    setHtml(null);
  }

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
    mode === "fill-width"
      ? { aspectRatio: `${nativeW} / ${nativeH}` }
      : {};
  const wrapClass =
    mode === "fill-width"
      ? "matrix-iframe-preview thumb-checker relative w-full overflow-hidden"
      : "matrix-iframe-preview thumb-checker relative size-full overflow-hidden";

  return (
    <div ref={wrapRef} className={wrapClass} style={wrapStyle}>
      {visible && html !== null && html !== "" && scale > 0 ? (
        <>
          <iframe
            title={`MC${message.number}${message.variant ?? ""} ${size}`}
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            className="matrix-iframe-preview__frame absolute block border-0"
            style={{
              width: nativeW,
              height: nativeH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              left:
                mode === "fit-rect" && box.w > 0 ? (box.w - scaledW) / 2 : 0,
              top:
                mode === "fit-rect" && box.h > 0 ? (box.h - scaledH) / 2 : 0,
            }}
          />
          <div
            className="matrix-iframe-preview__click-shield absolute inset-0 z-10"
            aria-hidden
          />
        </>
      ) : html === "" ? (
        <button
          type="button"
          onClick={retry}
          title="Click to retry. See browser console for the failure detail."
          className="matrix-iframe-preview__error flex size-full cursor-pointer items-center justify-center text-[10px] text-rose-500 hover:underline"
        >
          render failed — retry
        </button>
      ) : (
        <div className="matrix-iframe-preview__placeholder flex size-full items-center justify-center text-slate-300">
          <Code2 className="size-6" />
        </div>
      )}
    </div>
  );
}

// ── Masonry variant: bare iframe, no meta chrome (matches ImageTile) ──
export function MatrixIframeTile({
  message,
  templateName,
  size,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="matrix-iframe-tile group block w-full overflow-hidden rounded-md [content-visibility:auto] [contain-intrinsic-size:auto_300px]"
    >
      <MatrixIframePreview
        message={message}
        templateName={templateName}
        size={size}
        mode="fill-width"
      />
    </button>
  );
}

// ── Grid card variant: iframe + MC label + tags (matches Card) ──
export function MatrixIframeCard({
  message,
  templateName,
  size,
  product,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  product: string | null;
  onOpen: () => void;
}) {
  const mcLabel = `MC${message.number}${message.variant ?? ""}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="creative-card matrix-iframe-card group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 hover:shadow-md [content-visibility:auto] [contain-intrinsic-size:auto_220px]"
    >
      <div className="creative-card__thumb relative aspect-[4/3]">
        <MatrixIframePreview
          message={message}
          templateName={templateName}
          size={size}
          mode="fit-rect"
        />
      </div>
      <div className="creative-card__meta p-2 text-xs">
        <div className="flex items-baseline gap-2">
          <span className="creative-card__mc font-mono font-semibold text-slate-900">
            {mcLabel}
          </span>
          <span className="creative-card__filename truncate text-slate-700">
            {message.headline ?? message.name ?? "(no headline)"}
          </span>
        </div>
        <div className="creative-card__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {product ? <span className="tag-chip">{product}</span> : null}
          {message.template ? <span className="tag-chip">· {message.template}</span> : null}
          <span className="tag-chip">· {size}</span>
          {message.status ? <span className="tag-chip">· {message.status}</span> : null}
        </div>
      </div>
    </button>
  );
}

// ── List row variant: thumb + 6 aligned columns (matches ListRow) ──
export function MatrixIframeListRow({
  message,
  templateName,
  size,
  product,
  createdAt,
  updatedAt,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  product: string | null;
  createdAt: string;
  updatedAt: string;
  onOpen: () => void;
}) {
  const mcLabel = `MC${message.number}${message.variant ?? ""}`;
  const headline = message.headline ?? message.name ?? "(no headline)";
  const createdTitle = createdAt ? new Date(createdAt).toLocaleString() : "";
  const updatedTitle = updatedAt ? new Date(updatedAt).toLocaleString() : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="creative-row matrix-iframe-row group grid w-full items-center border-b border-slate-100 bg-white text-left text-xs transition hover:bg-slate-50 [content-visibility:auto] [contain-intrinsic-size:auto_52px]"
      style={{ gridTemplateColumns: LIST_GRID_TEMPLATE }}
    >
      <div className="creative-row__thumb my-1 ml-2 mr-0 size-10 shrink-0 overflow-hidden rounded border border-slate-200">
        <MatrixIframePreview
          message={message}
          templateName={templateName}
          size={size}
          mode="fit-rect"
        />
      </div>
      <div className="creative-row__mc truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] font-semibold text-slate-900">
        {mcLabel}
      </div>
      <div className="creative-row__name min-w-0 border-r border-slate-100 px-3 py-2">
        <span className="creative-row__filename block truncate text-slate-700" title={headline}>
          {headline}
        </span>
      </div>
      <div
        className="creative-row__product truncate border-r border-slate-100 px-3 py-2 text-slate-600"
        title={product ?? ""}
      >
        {product ?? "—"}
      </div>
      <div className="creative-row__type truncate border-r border-slate-100 px-3 py-2 text-slate-600">
        html
      </div>
      <div className="creative-row__size truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">
        {size}
      </div>
      <div
        className="creative-row__created truncate border-r border-slate-100 px-3 py-2 text-slate-500"
        title={createdTitle}
      >
        {formatListDate(createdAt)}
      </div>
      <div
        className="creative-row__updated truncate px-3 py-2 text-slate-500"
        title={updatedTitle}
      >
        {formatListDate(updatedAt)}
      </div>
    </button>
  );
}
