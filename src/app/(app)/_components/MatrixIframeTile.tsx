"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code2 } from "lucide-react";
import type { Message } from "../matrix/types";
import { LIST_GRID_TEMPLATE_VERSIONS, formatListDate } from "./ListSortHeader";
import {
  TemplatePreviewImage,
  type TemplateImageKind,
} from "./TemplatePreviewImage";

// Subset of TemplateInfo needed to switch between iframe render (html) and
// the static preview image (adobe/figma/after_effects). Optional everywhere
// so legacy call sites that don't pass it continue to iframe-render — matches
// the back-compat default in `readTemplate`.
export type TemplatePreviewMeta = {
  kind: "html" | TemplateImageKind;
  previewFile: string | null;
  externalUrl: string | null;
};

// Convenience: extract preview meta from a TemplateInfo-shape (where each
// consumer maintains its own local TemplateInfo type with optional kind
// fields). Returns undefined for missing input so the tile components fall
// back to iframe rendering — preserves the legacy behavior for HTML templates
// without forcing every call site to thread the same boilerplate.
export function templateMetaFor(
  t:
    | { kind?: string; previewFile?: string | null; externalUrl?: string | null }
    | undefined,
): TemplatePreviewMeta | undefined {
  if (!t || !t.kind) return undefined;
  if (
    t.kind !== "html" &&
    t.kind !== "adobe" &&
    t.kind !== "figma" &&
    t.kind !== "after_effects"
  ) {
    return undefined;
  }
  return {
    kind: t.kind,
    previewFile: t.previewFile ?? null,
    externalUrl: t.externalUrl ?? null,
  };
}

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
// Kind-aware dispatch wrapper: short-circuits non-html templates to the
// static preview image (no IntersectionObserver, no /api/render fetch). For
// html / unknown templates, hands off to `MatrixIframeRender` which owns the
// iframe machinery. Splitting the branch this way keeps the iframe hooks
// (useRef/useState/useEffect ×3) from violating Rules of Hooks on the
// non-html path.
export function MatrixIframePreview({
  message,
  templateName,
  size,
  mode,
  templateMeta,
  quietConsole,
}: {
  message: Message;
  templateName: string;
  size: string;
  mode: "fill-width" | "fit-rect";
  templateMeta?: TemplatePreviewMeta;
  quietConsole?: boolean;
}) {
  // nonDCO static-image MC: no template, a creative image in image1. Show the
  // image directly instead of iframe-rendering (which would POST /api/render
  // against a missing template dir and 404). Requires image1 so a half-set-up
  // DCO MC (null template, no image) still falls through to the placeholder.
  if (!message.template && message.image1) {
    return (
      <StaticImagePreview
        image={message.image1}
        mode={mode}
        label={`MC${message.number}${message.variant ?? ""}`}
      />
    );
  }
  if (templateMeta && templateMeta.kind !== "html") {
    return (
      <TemplatePreviewImage
        templateName={templateName}
        previewFile={templateMeta.previewFile}
        kind={templateMeta.kind}
        externalUrl={templateMeta.externalUrl}
        mode={mode}
      />
    );
  }
  return (
    <MatrixIframeRender
      message={message}
      templateName={templateName}
      size={size}
      mode={mode}
      quietConsole={quietConsole}
    />
  );
}

// Static creative image (nonDCO): renders message.image1 via the same
// /api/drive/proxy route + thumb-checker shell the editor's FileThumb uses, so
// a template-less image MC lines up visually with the html-iframe cells.
function StaticImagePreview({
  image,
  mode,
  label,
}: {
  image: string;
  mode: "fill-width" | "fit-rect";
  label: string;
}) {
  const src = `/api/drive/proxy/${encodeURIComponent(image)}`;
  if (mode === "fill-width") {
    return (
      <div className="matrix-static-preview thumb-checker relative w-full overflow-hidden">
        <img
          src={src}
          alt={label}
          className="matrix-static-preview__img block w-full"
          loading="lazy"
        />
      </div>
    );
  }
  return (
    <div className="matrix-static-preview thumb-checker relative size-full overflow-hidden">
      <img
        src={src}
        alt={label}
        className="matrix-static-preview__img absolute inset-0 size-full object-contain"
        loading="lazy"
      />
    </div>
  );
}

function MatrixIframeRender({
  message,
  templateName,
  size,
  mode,
  quietConsole,
}: {
  message: Message;
  templateName: string;
  size: string;
  mode: "fill-width" | "fit-rect";
  quietConsole?: boolean;
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
        quietConsole: quietConsole === true,
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
  }, [visible, html, message.id, message.version, templateName, size, quietConsole]);

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
  templateMeta,
  quietConsole,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  templateMeta?: TemplatePreviewMeta;
  quietConsole?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="matrix-iframe-tile group block w-full overflow-hidden rounded-md bg-slate-100 dark:bg-black [content-visibility:auto] [contain-intrinsic-size:auto_300px]"
    >
      <MatrixIframePreview
        message={message}
        templateName={templateName}
        size={size}
        mode="fill-width"
        templateMeta={templateMeta}
        quietConsole={quietConsole}
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
  templateMeta,
  quietConsole,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  product: string | null;
  templateMeta?: TemplatePreviewMeta;
  quietConsole?: boolean;
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
          templateMeta={templateMeta}
          quietConsole={quietConsole}
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
  templateMeta,
  quietConsole,
  onOpen,
}: {
  message: Message;
  templateName: string;
  size: string;
  product: string | null;
  createdAt: string;
  updatedAt: string;
  templateMeta?: TemplatePreviewMeta;
  quietConsole?: boolean;
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
      style={{ gridTemplateColumns: LIST_GRID_TEMPLATE_VERSIONS }}
    >
      <div className="creative-row__thumb my-1 ml-2 mr-0 size-10 shrink-0 overflow-hidden rounded border border-slate-200">
        <MatrixIframePreview
          message={message}
          templateName={templateName}
          size={size}
          mode="fit-rect"
          templateMeta={templateMeta}
          quietConsole={quietConsole}
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
      <div className="creative-row__versions truncate border-r border-slate-100 px-3 py-2 text-slate-600">
        —
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
