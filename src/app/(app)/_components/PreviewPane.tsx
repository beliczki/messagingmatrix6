"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Sun,
  Moon,
  Grid as GridIcon,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { mediaKindFromFilename } from "@/lib/parse-filename";
import { TemplatePreviewImage } from "./TemplatePreviewImage";
import type { TemplatePreviewMeta } from "./MatrixIframeTile";

export type PreviewBg = "light" | "dark" | "checker";

/** Stored-preview-PNG mode state (editor "Image preview" toggle). */
export type PreviewImageState = {
  /** PNG URL for the current size; null = no preview generated yet. */
  url: string | null;
  /** The MC was edited since this preview was shot. */
  stale: boolean;
  generating: boolean;
  error: string | null;
  onGenerate: () => void;
};

type Props = {
  html: string;
  sizes: string[];
  size: string | null;
  onSizeChange: (s: string) => void;
  bg: PreviewBg;
  onBgChange: (b: PreviewBg) => void;
  skipAnim: boolean;
  onSkipAnimChange: (v: boolean) => void;
  onRefresh?: () => void;
  rightExtras?: React.ReactNode;
  /** "Image preview" mode — show the stored preview PNG instead of the live
   *  iframe. The toggle renders only when onImagePreviewChange is provided
   *  (and the template is html-kind). */
  imagePreview?: boolean;
  onImagePreviewChange?: (v: boolean) => void;
  imageState?: PreviewImageState;
  /** When the template kind is non-html, the viewport renders the template
   *  folder's preview image instead of the HTML iframe. `templateName` is
   *  required so the image URL can be constructed. Optional — undefined or
   *  kind="html" keeps the current iframe behavior. */
  templateMeta?: TemplatePreviewMeta;
  templateName?: string;
  /** nonDCO static-image MC: a creative filename (image1) with no template.
   *  When set, the viewport shows the image via /api/drive/proxy instead of the
   *  size-driven HTML iframe (which has no template/size to render). */
  staticImage?: string | null;
};

export default function PreviewPane({
  html,
  sizes,
  size,
  onSizeChange,
  bg,
  onBgChange,
  skipAnim,
  onSkipAnimChange,
  onRefresh,
  rightExtras,
  imagePreview,
  onImagePreviewChange,
  imageState,
  templateMeta,
  templateName,
  staticImage,
}: Props) {
  const showStatic = !!staticImage;
  const staticKind = staticImage ? mediaKindFromFilename(staticImage) : null;
  const showImage =
    !showStatic &&
    templateMeta &&
    templateMeta.kind !== "html" &&
    typeof templateName === "string";
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * Scrolling or swiping over the viewport cycles the size, wrapping at both
   * ends — the sizes of one creative are a ring, not a list with a stop.
   *
   * The listener is attached by hand rather than with onWheel because React's
   * wheel handler is passive: without preventDefault the page behind scrolls
   * while the size changes. The viewport itself never scrolls (overflow-hidden),
   * so nothing legitimate is being stolen.
   */
  const cycleRef = useRef({ acc: 0, at: 0, x: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el || sizes.length < 2) return;
    const step = (dir: number) => {
      // No size chosen yet counts as "before the first", so one notch either
      // way lands on a real size rather than doing nothing.
      const i = size === null ? -1 : sizes.indexOf(size);
      const from = i === -1 ? 0 : i;
      onSizeChange(sizes[(from + dir + sizes.length) % sizes.length]!);
    };
    // A trackpad emits a burst of small deltas per gesture; accumulate to a
    // threshold and then hold off, or one flick would run through every size.
    const WHEEL_STEP = 60;
    const COOLDOWN_MS = 220;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - cycleRef.current.at < COOLDOWN_MS) return;
      cycleRef.current.acc += e.deltaY + e.deltaX;
      if (Math.abs(cycleRef.current.acc) < WHEEL_STEP) return;
      step(cycleRef.current.acc > 0 ? 1 : -1);
      cycleRef.current.acc = 0;
      cycleRef.current.at = now;
    };
    const onTouchStart = (e: TouchEvent) => {
      cycleRef.current.x = e.touches[0]?.clientX ?? 0;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const dx = (e.changedTouches[0]?.clientX ?? 0) - cycleRef.current.x;
      if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [sizes, size, onSizeChange]);

  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  function handleRefresh() {
    setReloadKey((k) => k + 1);
    onRefresh?.();
  }

  return (
    <div className="preview-pane flex h-full flex-col">
      <div className="preview-pane__toolbar flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
        <div className="flex items-center gap-2">
          {/* Static-image MCs (nonDCO creatives) list the creative's REAL sizes
              (same MC number+variant, one row per stored size); switching shows
              that size's file. No template/animation, so the skip-animation +
              image-preview toggles are hidden — the viewport is a plain
              Creative-Library-style image box. */}
          {sizes.length > 0 ? (
            <select
              value={size ?? ""}
              onChange={(e) => onSizeChange(e.target.value)}
              className="custom-dropdown preview-pane__size-select rounded border border-border bg-surface px-2 py-1 text-xs"
              disabled={sizes.length === 0}
            >
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : showStatic ? (
            <span className="preview-pane__static-label text-xs text-text-secondary">
              {staticImage}
            </span>
          ) : null}
          {!showStatic ? (
            <button
              onClick={() => onSkipAnimChange(!skipAnim)}
              className={clsx(
                "preview-pane__skip-anim flex items-center gap-1 rounded border px-2 py-1 text-xs",
                skipAnim
                  ? "preview-pane__skip-anim--active border-text-primary bg-text-primary text-background"
                  : "border-border bg-surface text-text-primary hover:bg-surface-alt",
              )}
              title="Skip animations in preview"
            >
              <span
                className={clsx(
                  "flex size-3.5 items-center justify-center rounded-sm border",
                  skipAnim
                    ? "border-background bg-background text-text-primary"
                    : "border-border-subtle",
                )}
              >
                {skipAnim && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              Skip animation
            </button>
          ) : null}
          {onImagePreviewChange && !showImage && !showStatic ? (
            <button
              onClick={() => onImagePreviewChange(!imagePreview)}
              className={clsx(
                "preview-pane__image-toggle flex items-center gap-1 rounded border px-2 py-1 text-xs",
                imagePreview
                  ? "preview-pane__image-toggle--active border-text-primary bg-text-primary text-background"
                  : "border-border bg-surface text-text-primary hover:bg-surface-alt",
              )}
              title="Show the stored preview PNG instead of the live render"
            >
              <span
                className={clsx(
                  "flex size-3.5 items-center justify-center rounded-sm border",
                  imagePreview
                    ? "border-background bg-background text-text-primary"
                    : "border-border-subtle",
                )}
              >
                {imagePreview && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              Image preview
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <div className="preview-pane__bg-group flex overflow-hidden rounded border border-border">
            <BgBtn active={bg === "light"} onClick={() => onBgChange("light")} title="Light background">
              <Sun className="size-3.5" />
            </BgBtn>
            <BgBtn active={bg === "checker"} onClick={() => onBgChange("checker")} title="Checker background">
              <GridIcon className="size-3.5" />
            </BgBtn>
            <BgBtn active={bg === "dark"} onClick={() => onBgChange("dark")} title="Dark background">
              <Moon className="size-3.5" />
            </BgBtn>
          </div>
          {onRefresh ? (
            <button
              onClick={handleRefresh}
              className="preview-pane__refresh rounded border border-border bg-surface p-1 text-text-primary hover:bg-surface-alt"
              title="Refresh preview"
            >
              <RefreshCw className="size-3.5" />
            </button>
          ) : null}
          {rightExtras}
        </div>
      </div>
      <div
        ref={boxRef}
        className={clsx(
          "preview-pane__viewport flex flex-1 items-center justify-center overflow-hidden",
          bg === "light" && "preview-viewport--light",
          bg === "dark" && "preview-viewport--dark",
          bg === "checker" && "preview-viewport--checker",
        )}
      >
        {showStatic ? (
          <div className="preview-pane__static-wrap relative flex size-full items-center justify-center overflow-hidden">
            {/* A nonDCO creative is whatever file was delivered, and plenty of
                them are .mp4 — an <img> would render the alt text on the
                checkerboard. Same treatment the asset previews use. */}
            {staticKind === "video" ? (
              <video
                src={`/api/drive/proxy/${encodeURIComponent(staticImage!)}#t=0.1`}
                className="preview-pane__static-video max-h-full max-w-full object-contain"
                controls
                preload="metadata"
                muted
                playsInline
              />
            ) : (
              <img
                src={`/api/drive/proxy/${encodeURIComponent(staticImage!)}`}
                alt={staticImage!}
                className="preview-pane__static-img max-h-full max-w-full object-contain"
                loading="lazy"
              />
            )}
          </div>
        ) : showImage ? (
          <div className="preview-pane__image-wrap relative size-full max-h-full max-w-full">
            <TemplatePreviewImage
              templateName={templateName!}
              previewFile={templateMeta!.previewFile}
              kind={
                templateMeta!.kind as Exclude<TemplatePreviewMeta["kind"], "html">
              }
              externalUrl={templateMeta!.externalUrl}
              mode="fit-rect"
            />
          </div>
        ) : imagePreview && imageState ? (
          <PreviewImage size={size} box={box} state={imageState} />
        ) : (
          <PreviewIframe key={reloadKey} html={html} size={size} box={box} />
        )}
      </div>
      {imagePreview && imageState && !showImage && !showStatic ? (
        <div className="preview-pane__image-footer flex h-9 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-xs">
          {imageState.url ? (
            <a
              href={imageState.url}
              target="_blank"
              rel="noreferrer"
              className="preview-pane__image-open text-text-primary underline hover:no-underline"
            >
              Open in new tab
            </a>
          ) : null}
          <button
            onClick={imageState.onGenerate}
            disabled={imageState.generating}
            className="preview-pane__image-generate toolbar-btn rounded border border-border bg-surface px-2 py-1 text-text-primary hover:bg-surface-alt disabled:opacity-50"
          >
            {imageState.generating
              ? "Generating…"
              : imageState.url
                ? "Regenerate"
                : "Generate"}
          </button>
          {imageState.error ? (
            <span className="preview-pane__image-error text-red-600">
              {imageState.error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Stored preview PNG at native ad dimensions, scaled to fit like the iframe.
function PreviewImage({
  size,
  box,
  state,
}: {
  size: string | null;
  box: { w: number; h: number };
  state: PreviewImageState;
}) {
  if (!size) return null;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const adW = parseInt(m[1], 10);
  const adH = parseInt(m[2], 10);
  const margin = 16;
  const availW = Math.max(0, box.w - margin * 2);
  const availH = Math.max(0, box.h - margin * 2);
  const scale =
    box.w === 0 || box.h === 0 ? 1 : Math.min(1, availW / adW, availH / adH);

  if (!state.url) {
    return (
      <div
        className="preview-pane__image-placeholder flex items-center justify-center border border-dashed border-border text-xs text-text-secondary"
        style={{
          width: adW,
          height: adH,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: "center center",
          flexShrink: 0,
        }}
      >
        No preview generated for {size}
      </div>
    );
  }
  return (
    <div
      className="relative"
      style={{
        width: adW,
        height: adH,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: "center center",
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- raw stored PNG at native size */}
      <img
        alt={`Preview ${size}`}
        src={state.url}
        width={adW}
        height={adH}
        className="preview-pane__image"
        style={{
          background: "white",
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        }}
      />
      {state.stale ? (
        <span className="preview-pane__image-stale absolute left-1 top-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
          Stale — MC edited since this preview
        </span>
      ) : null}
    </div>
  );
}

function BgBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "preview-pane__bg-btn flex items-center justify-center px-1.5 py-1 transition-colors",
        active
          ? "preview-pane__bg-btn--active bg-text-primary text-background"
          : "bg-surface text-text-primary hover:bg-surface-alt",
      )}
    >
      {children}
    </button>
  );
}

function PreviewIframe({
  html,
  size,
  box,
}: {
  html: string;
  size: string | null;
  box: { w: number; h: number };
}) {
  if (!size) return null;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const adW = parseInt(m[1], 10);
  const adH = parseInt(m[2], 10);
  const margin = 16;
  const availW = Math.max(0, box.w - margin * 2);
  const availH = Math.max(0, box.h - margin * 2);
  const scale =
    box.w === 0 || box.h === 0
      ? 1
      : Math.min(1, availW / adW, availH / adH);
  return (
    <iframe
      title="preview"
      srcDoc={html}
      sandbox="allow-same-origin allow-scripts"
      className="preview-pane__iframe"
      style={{
        width: adW,
        height: adH,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: "center center",
        border: 0,
        background: "white",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        flexShrink: 0,
      }}
    />
  );
}
