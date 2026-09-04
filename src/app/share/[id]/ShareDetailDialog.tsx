"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Grid as GridIcon,
  Loader2,
  MapPin,
  Moon,
  Square,
  Sun,
  X,
} from "lucide-react";
import clsx from "clsx";
import ImagePreviewToggle from "./ImagePreviewToggle";
import { bgClassFor, type PreviewBg } from "./preview-bg";
import GoogleDriveIcon from "@/app/_components/GoogleDriveIcon";
import AnnotationLayer, {
  type Annotation,
  type AnnotationMode,
  type CommentAnnotation,
} from "./AnnotationLayer";
import ModalBackdrop from "@/app/(app)/_components/ModalBackdrop";


export type DialogItem =
  | {
      kind: "matrix";
      key: string;
      itemKey: string;
      size: string;
      message: {
        id: number;
        number: number;
        variant: string;
        template: string | null;
        headline: string | null;
        copy1?: string | null;
        copy2?: string | null;
        disclaimer?: string | null;
        cta?: string | null;
        flash?: string | null;
        landingUrl?: string | null;
        audience?: string;
        topic?: string;
        status?: string | null;
      };
    }
  | {
      kind: "creative";
      key: string;
      itemKey: string;
      size: string | null;
      creative: {
        id: number;
        brand: string | null;
        product: string | null;
        type: string | null;
        template: string | null;
        mcNumber: number | null;
        mcVariant: string | null;
        fileName: string | null;
        fileFormat: string | null;
        fileDimensions: string | null;
        comment: string | null;
        driveFolderId?: string | null;
        driveFolderName?: string | null;
      };
      file:
        | {
            id: string;
            filename: string;
            mimeType: string | null;
          }
        | undefined;
    };

export type ShareCommentRow = {
  id: string;
  itemKey: string;
  authorName: string;
  body: string;
  annotation: string | null;
  createdAt: string;
};


type Props = {
  shareId: string;
  item: DialogItem;
  navItems: DialogItem[];
  navIndex: number;
  onJump: (i: number) => void;
  onClose: () => void;
  // The gallery's own image-preview switch, handed down rather than duplicated:
  // one piece of state behind both controls, so flipping either is immediately
  // true of the other with no syncing effect to get wrong.
  imageMode: boolean;
  setImageMode: (v: boolean) => void;
  /** Stored preview image for the item on screen; null when it has none. */
  imageSrc: string | null;
  comments: ShareCommentRow[];
  authorName: string;
  setAuthorName: (s: string) => void;
  onCommentPosted: () => void;
};

function parseSize(size: string): { w: number; h: number; landscape: boolean } {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return { w: 300, h: 250, landscape: false };
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  return { w, h, landscape: w > h };
}


function parseAnnotation(raw: string | null | undefined): Annotation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Annotation;
    if (
      parsed &&
      (parsed.type === "point" || parsed.type === "rect") &&
      typeof parsed.x === "number" &&
      typeof parsed.y === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function labelFor(item: DialogItem): string {
  if (item.kind === "matrix") {
    return `MC${item.message.number}${item.message.variant}`;
  }
  if (item.creative.mcNumber !== null && item.creative.mcNumber !== undefined) {
    return `MC${item.creative.mcNumber}${item.creative.mcVariant ?? ""}`;
  }
  return item.creative.fileName ?? "Creative";
}

export default function ShareDetailDialog({
  shareId,
  item,
  navItems,
  navIndex,
  onJump,
  onClose,
  imageMode,
  setImageMode,
  imageSrc,
  comments,
  authorName,
  setAuthorName,
  onCommentPosted,
}: Props) {
  const [bg, setBg] = useState<PreviewBg>("checker");
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>("off");
  const [pending, setPending] = useState<Annotation | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Reset transient state when the user navigates to a different item.
  useEffect(() => {
    setAnnotationMode("off");
    setPending(null);
    setHighlightId(null);
  }, [item.key]);

  const itemComments = useMemo(
    () => comments.filter((c) => c.itemKey === item.itemKey),
    [comments, item.itemKey],
  );
  const overlays: CommentAnnotation[] = useMemo(() => {
    const out: CommentAnnotation[] = [];
    let n = 0;
    for (const c of itemComments) {
      const a = parseAnnotation(c.annotation);
      if (!a) continue;
      n += 1;
      out.push({ ...a, id: c.id, index: n });
    }
    return out;
  }, [itemComments]);

  function navigatePrev() {
    if (navIndex > 0) onJump(navIndex - 1);
  }
  function navigateNext() {
    if (navIndex >= 0 && navIndex < navItems.length - 1) onJump(navIndex + 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") navigatePrev();
      if (e.key === "ArrowRight") navigateNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const subtitle =
    item.kind === "matrix"
      ? (item.message.headline ?? null)
      : (item.creative.fileName ?? null);
  const sizeLabel =
    item.kind === "matrix" ? item.size : item.creative.fileDimensions;

  function activateMode(next: AnnotationMode) {
    setAnnotationMode(next);
    if (next !== "off") setPending(null);
  }

  function clearPending() {
    setPending(null);
  }

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-stretch">
      <div className="share-detail-dialog modal m-auto flex h-[92vh] w-[92vw] max-w-7xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="share-detail-dialog__header modal__header flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <button
            onClick={navigatePrev}
            disabled={navIndex <= 0}
            aria-label="Previous"
            className="share-detail-dialog__nav-prev rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="share-detail-dialog__title-block flex min-w-0 items-baseline gap-2">
            <span className="share-detail-dialog__title font-mono text-sm font-semibold text-slate-900">
              {labelFor(item)}
            </span>
            {sizeLabel ? (
              <span className="share-detail-dialog__size font-mono text-xs text-slate-500">
                {sizeLabel}
              </span>
            ) : null}
            {subtitle ? (
              <span className="share-detail-dialog__subtitle truncate text-xs text-slate-500">
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            onClick={navigateNext}
            disabled={navIndex < 0 || navIndex >= navItems.length - 1}
            aria-label="Next"
            className="share-detail-dialog__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="share-detail-dialog__nav-counter text-xs text-slate-500">
            {navIndex + 1}/{navItems.length}
          </span>
          <div className="share-detail-dialog__header-actions ml-auto flex items-center gap-2">
            {item.kind === "matrix" ? (
              <ImagePreviewToggle
                on={imageMode}
                onChange={setImageMode}
                compact
              />
            ) : null}
            <BgToggle bg={bg} setBg={setBg} />
            <DownloadAction item={item} shareId={shareId} />
            {item.kind === "creative" && item.creative.driveFolderId ? (
              <a
                href={`https://drive.google.com/drive/folders/${item.creative.driveFolderId}`}
                target="_blank"
                rel="noreferrer"
                title={`Open ${item.creative.driveFolderName ?? "the delivery folder"} on Google Drive`}
                className="share-detail-dialog__drive toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <GoogleDriveIcon className="size-3" />
                Google Drive
              </a>
            ) : null}
            <button
              onClick={onClose}
              aria-label="Close"
              className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>

        <div className="share-detail-dialog__body flex flex-1 overflow-hidden">
          <section className="share-detail-dialog__pane--preview flex flex-1 flex-col overflow-hidden bg-slate-50">
            <div
              className={`share-detail-dialog__preview-stage flex flex-1 items-center justify-center overflow-hidden p-4 ${bgClassFor(bg)}`}
            >
              <PreviewBody
                item={item}
                shareId={shareId}
                imageMode={imageMode}
                imageSrc={imageSrc}
                overlays={overlays}
                pending={pending}
                annotationMode={annotationMode}
                highlightId={highlightId}
                setHighlightId={setHighlightId}
                onDraw={(a) => {
                  setPending(a);
                  setAnnotationMode("off");
                }}
              />
            </div>
          </section>

          <aside className="share-detail-dialog__pane--side flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
            <div className="share-detail-dialog__side-tabs flex h-10 shrink-0 items-center gap-1 border-b border-slate-200 px-3 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Comments · {itemComments.length}
            </div>
            <div className="share-detail-dialog__side-body flex flex-1 flex-col overflow-hidden">
              <CommentList
                comments={itemComments}
                overlays={overlays}
                highlightId={highlightId}
                setHighlightId={setHighlightId}
              />
              <CommentForm
                shareId={shareId}
                itemKey={item.itemKey}
                authorName={authorName}
                setAuthorName={setAuthorName}
                onPosted={() => {
                  setPending(null);
                  onCommentPosted();
                }}
                annotationMode={annotationMode}
                activateMode={activateMode}
                pending={pending}
                clearPending={clearPending}
              />
            </div>
          </aside>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function PreviewBody({
  item,
  shareId,
  imageMode,
  imageSrc,
  overlays,
  pending,
  annotationMode,
  highlightId,
  setHighlightId,
  onDraw,
}: {
  item: DialogItem;
  shareId: string;
  imageMode: boolean;
  imageSrc: string | null;
  overlays: CommentAnnotation[];
  pending: Annotation | null;
  annotationMode: AnnotationMode;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  onDraw: (a: Annotation) => void;
}) {
  if (item.kind === "matrix") {
    if (!item.message.template) {
      return <div className="text-xs text-rose-500">no template</div>;
    }
    return (
      <MatrixPreviewStage
        shareId={shareId}
        messageId={item.message.id}
        templateName={item.message.template}
        size={item.size}
        imageMode={imageMode}
        imageSrc={imageSrc}
        title={`${labelFor(item)} ${item.size}`}
        overlays={overlays}
        pending={pending}
        annotationMode={annotationMode}
        highlightId={highlightId}
        setHighlightId={setHighlightId}
        onDraw={onDraw}
      />
    );
  }
  return (
    <CreativePreviewStage
      item={item}
      shareId={shareId}
      overlays={overlays}
      pending={pending}
      annotationMode={annotationMode}
      highlightId={highlightId}
      setHighlightId={setHighlightId}
      onDraw={onDraw}
    />
  );
}

function MatrixPreviewStage({
  shareId,
  messageId,
  templateName,
  size,
  imageMode,
  imageSrc,
  title,
  overlays,
  pending,
  annotationMode,
  highlightId,
  setHighlightId,
  onDraw,
}: {
  shareId: string;
  messageId: number;
  templateName: string;
  size: string;
  imageMode: boolean;
  imageSrc: string | null;
  title: string;
  overlays: CommentAnnotation[];
  pending: Annotation | null;
  annotationMode: AnnotationMode;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  onDraw: (a: Annotation) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dims = useMemo(() => parseSize(size), [size]);
  const [html, setHtml] = useState<string | null>(null);

  // Image mode swaps the live render for the stored PNG. Geometry is untouched
  // — same scaled box, same AnnotationLayer — so existing pin/box coordinates
  // keep pointing at the same spot on the banner. Falling back to the live
  // render when this item has no stored image is deliberate: a blank stage
  // would read as "this ad is broken" rather than "no preview generated yet".
  const useImage = imageMode && !!imageSrc;

  useEffect(() => {
    if (useImage) return;
    setHtml(null);
    let cancelled = false;
    fetch("/api/render/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId, messageId, size, templateName }),
    })
      .then((r) => (r.ok ? r.text() : Promise.reject(r)))
      .then((text) => {
        if (!cancelled) setHtml(text);
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [shareId, messageId, size, templateName, useImage]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const margin = 16;
  const scale =
    box.w > 0 && box.h > 0
      ? Math.min(
          1,
          (box.w - margin * 2) / dims.w,
          (box.h - margin * 2) / dims.h,
        )
      : 0;
  const scaledW = dims.w * scale;
  const scaledH = dims.h * scale;

  return (
    <div ref={stageRef} className="relative flex size-full items-center justify-center">
      {!useImage && html === null ? (
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <Loader2 className="size-3 animate-spin" />
          loading…
        </div>
      ) : !useImage && html === "" ? (
        <div className="text-xs text-rose-500">render failed</div>
      ) : scale > 0 ? (
        <div style={{ width: scaledW, height: scaledH, position: "relative" }}>
          <AnnotationLayer
            annotations={overlays}
            pending={pending}
            mode={annotationMode}
            highlightId={highlightId}
            onAnnotationHover={setHighlightId}
            onDraw={onDraw}
          >
            {useImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSrc!}
                alt={title}
                className="block bg-white"
                style={{
                  width: dims.w,
                  height: dims.h,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              />
            ) : (
              <iframe
                title={title}
                srcDoc={html!}
                sandbox="allow-scripts allow-same-origin"
                className="block border-0 bg-white"
                style={{
                  width: dims.w,
                  height: dims.h,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  position: "absolute",
                  top: 0,
                  left: 0,
                }}
              />
            )}
          </AnnotationLayer>
        </div>
      ) : null}
    </div>
  );
}

function CreativePreviewStage({
  item,
  shareId,
  overlays,
  pending,
  annotationMode,
  highlightId,
  setHighlightId,
  onDraw,
}: {
  item: Extract<DialogItem, { kind: "creative" }>;
  shareId: string;
  overlays: CommentAnnotation[];
  pending: Annotation | null;
  annotationMode: AnnotationMode;
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
  onDraw: (a: Annotation) => void;
}) {
  const file = item.file;
  if (!file) {
    return (
      <div className="text-xs text-slate-400">no file</div>
    );
  }
  const isImage = file.mimeType?.startsWith("image/") ?? false;
  const isVideo = file.mimeType?.startsWith("video/") ?? false;
  const fullSrc = `/share/${shareId}/file/${file.id}`;
  if (isImage) {
    return (
      <AnnotationLayer
        annotations={overlays}
        pending={pending}
        mode={annotationMode}
        highlightId={highlightId}
        onAnnotationHover={setHighlightId}
        onDraw={onDraw}
        fill={false}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={fullSrc}
          alt={item.creative.fileName ?? file.filename}
          className="block max-h-[80vh] max-w-[min(100%,80vw)] object-contain"
        />
      </AnnotationLayer>
    );
  }
  if (isVideo) {
    return (
      <AnnotationLayer
        annotations={overlays}
        pending={pending}
        mode={annotationMode}
        highlightId={highlightId}
        onAnnotationHover={setHighlightId}
        onDraw={onDraw}
        fill={false}
      >
        <video
          src={fullSrc}
          className="block max-h-[80vh] max-w-[min(100%,80vw)]"
          controls
          preload="metadata"
        />
      </AnnotationLayer>
    );
  }
  return (
    <div className="text-xs text-slate-400">{file.mimeType ?? "binary"}</div>
  );
}

function CommentList({
  comments,
  overlays,
  highlightId,
  setHighlightId,
}: {
  comments: ShareCommentRow[];
  overlays: CommentAnnotation[];
  highlightId: string | null;
  setHighlightId: (id: string | null) => void;
}) {
  const idxById = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of overlays) m.set(o.id, o.index);
    return m;
  }, [overlays]);
  return (
    <ul className="comment-list flex-1 space-y-2 overflow-y-auto px-3 py-3">
      {comments.length === 0 ? (
        <li className="comment-list__empty text-[11px] text-slate-400">
          No comments yet.
        </li>
      ) : (
        comments.map((c) => {
          const idx = idxById.get(c.id);
          return (
            <li
              key={c.id}
              onMouseEnter={() => idx !== undefined && setHighlightId(c.id)}
              onMouseLeave={() => setHighlightId(null)}
              className={clsx(
                "comment rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs",
                highlightId === c.id && "ring-2 ring-rose-400",
              )}
            >
              <div className="comment__head flex items-baseline gap-2 text-[10px] text-slate-400">
                {idx !== undefined ? (
                  <span
                    className={clsx(
                      "comment__index flex size-4 items-center justify-center rounded-full text-[9px] font-semibold text-white",
                      highlightId === c.id ? "bg-rose-500" : "bg-slate-900",
                    )}
                  >
                    {idx}
                  </span>
                ) : null}
                <span className="comment__author font-semibold text-slate-700">
                  {c.authorName}
                </span>
                <span className="comment__time">
                  {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="comment__body whitespace-pre-wrap text-slate-700">
                {c.body}
              </p>
            </li>
          );
        })
      )}
    </ul>
  );
}

function CommentForm({
  shareId,
  itemKey,
  authorName,
  setAuthorName,
  onPosted,
  annotationMode,
  activateMode,
  pending,
  clearPending,
}: {
  shareId: string;
  itemKey: string;
  authorName: string;
  setAuthorName: (s: string) => void;
  onPosted: () => void;
  annotationMode: AnnotationMode;
  activateMode: (m: AnnotationMode) => void;
  pending: Annotation | null;
  clearPending: () => void;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!authorName.trim() || !body.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/share/${shareId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemKey,
          authorName: authorName.trim(),
          body: body.trim(),
          annotation: pending,
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Post failed (${r.status})`);
      }
      setBody("");
      onPosted();
      bodyRef.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="comment-form shrink-0 space-y-2 border-t border-slate-200 bg-slate-50 px-3 py-3"
    >
      <div className="comment-form__annotate flex flex-wrap items-center gap-1.5">
        <span className="comment-form__annotate-label text-[10px] uppercase tracking-wide text-slate-500">
          Annotate
        </span>
        <button
          type="button"
          onClick={() => activateMode(annotationMode === "point" ? "off" : "point")}
          title="Click the preview to drop a pin"
          className={clsx(
            "annotation-mode-btn inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
            annotationMode === "point"
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          <MapPin className="size-3" />
          Pin
        </button>
        <button
          type="button"
          onClick={() => activateMode(annotationMode === "rect" ? "off" : "rect")}
          title="Drag on the preview to draw a rectangle"
          className={clsx(
            "annotation-mode-btn inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
            annotationMode === "rect"
              ? "border-amber-500 bg-amber-500 text-white"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          <Square className="size-3" />
          Box
        </button>
        {pending ? (
          <span className="annotation-pending inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
            {pending.type === "point" ? "Pin attached" : "Box attached"}
            <button
              type="button"
              onClick={clearPending}
              className="annotation-pending__clear rounded p-0.5 hover:bg-amber-100"
              aria-label="Remove annotation"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : annotationMode !== "off" ? (
          <span className="comment-form__annotate-hint text-[11px] text-slate-500">
            {annotationMode === "point"
              ? "Click the preview."
              : "Drag on the preview."}
          </span>
        ) : null}
      </div>
      <input
        type="text"
        value={authorName}
        onChange={(e) => setAuthorName(e.target.value)}
        placeholder="Your name"
        maxLength={80}
        required
        className="input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      />
      <textarea
        ref={bodyRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        rows={2}
        maxLength={2000}
        required
        className="input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      />
      {error ? (
        <p className="comment-form__error text-[11px] text-rose-600">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={submitting || !authorName.trim() || !body.trim()}
        className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? <Loader2 className="size-3 animate-spin" /> : null}
        {submitting ? "Posting…" : "Post comment"}
      </button>
    </form>
  );
}

function BgToggle({
  bg,
  setBg,
}: {
  bg: PreviewBg;
  setBg: (b: PreviewBg) => void;
}) {
  const opts: Array<{ k: PreviewBg; title: string; icon: React.ReactNode }> = [
    { k: "light", title: "Light", icon: <Sun className="size-3.5" /> },
    { k: "checker", title: "Checker", icon: <GridIcon className="size-3.5" /> },
    { k: "dark", title: "Dark", icon: <Moon className="size-3.5" /> },
  ];
  return (
    <div className="bg-toggle flex overflow-hidden rounded-md border border-slate-200 bg-white">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => setBg(o.k)}
          title={o.title}
          aria-label={o.title}
          className={clsx(
            "bg-toggle__btn flex items-center justify-center px-1.5 py-1 transition-colors",
            bg === o.k
              ? "bg-toggle__btn--active bg-slate-900 text-white"
              : "bg-white text-slate-700 hover:bg-slate-50",
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

function DownloadAction({ item, shareId }: { item: DialogItem; shareId: string }) {
  if (item.kind === "creative") {
    return <CreativeDownload item={item} shareId={shareId} />;
  }
  return <MatrixDownload item={item} shareId={shareId} />;
}

function CreativeDownload({
  item,
  shareId,
}: {
  item: Extract<DialogItem, { kind: "creative" }>;
  shareId: string;
}) {
  if (!item.file) return null;
  return (
    <a
      href={`/share/${shareId}/file/${item.file.id}`}
      download={item.creative.fileName ?? item.file.filename}
      className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
    >
      <Download className="size-3" />
      Download
    </a>
  );
}

function MatrixDownload({
  item,
  shareId,
}: {
  item: Extract<DialogItem, { kind: "matrix" }>;
  shareId: string;
}) {
  async function go() {
    const r = await fetch("/api/render/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shareId,
        messageId: item.message.id,
        size: item.size,
        download: true,
      }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MC${item.message.number}${item.message.variant}-${item.size}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button
      type="button"
      onClick={go}
      className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
    >
      <Download className="size-3" />
      Download
    </button>
  );
}
