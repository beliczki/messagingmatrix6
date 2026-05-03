"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

export type Annotation =
  | { type: "point"; x: number; y: number }
  | { type: "rect"; x: number; y: number; w: number; h: number };

export type CommentAnnotation = Annotation & { id: string; index: number };

export type AnnotationMode = "off" | "point" | "rect";

type Props = {
  /** Existing annotations from posted comments to overlay. */
  annotations: CommentAnnotation[];
  /** Annotation currently being authored — overlaid in a different colour. */
  pending: Annotation | null;
  /** Active draw mode controlled by the comment form. */
  mode: AnnotationMode;
  /** Highlighted comment id (e.g. on hover) — that overlay gets the focus ring. */
  highlightId: string | null;
  /** Hover handler to mirror highlighting back to the comment list. */
  onAnnotationHover: (id: string | null) => void;
  /** Called when user finishes drawing an annotation. */
  onDraw: (a: Annotation) => void;
  /** Element being annotated (the preview thumb). */
  children: ReactNode;
  /**
   * When true (default), the layer sizes to fill its parent (`size-full`).
   * Use when the wrapped content is absolutely positioned (iframe-in-stage).
   * Set false when the children have intrinsic size (e.g. an `<img>`) so the
   * layer collapses around the content and the parent flex container can
   * center it correctly.
   */
  fill?: boolean;
};

export default function AnnotationLayer({
  annotations,
  pending,
  mode,
  highlightId,
  onAnnotationHover,
  onDraw,
  children,
  fill = true,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null);

  function unitFromPointer(e: React.PointerEvent | PointerEvent): { x: number; y: number } | null {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (mode === "off") return;
    if (e.button !== undefined && e.button !== 0) return;
    const u = unitFromPointer(e);
    if (!u) return;
    e.stopPropagation();
    if (mode === "point") {
      onDraw({ type: "point", x: u.x, y: u.y });
      return;
    }
    if (mode === "rect") {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {}
      setDrag({ x: u.x, y: u.y, cx: u.x, cy: u.y });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const u = unitFromPointer(e);
    if (!u) return;
    setDrag({ ...drag, cx: u.x, cy: u.y });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    const x = Math.min(drag.x, drag.cx);
    const y = Math.min(drag.y, drag.cy);
    const w = Math.abs(drag.cx - drag.x);
    const h = Math.abs(drag.cy - drag.y);
    setDrag(null);
    if (w < 0.01 || h < 0.01) return;
    onDraw({ type: "rect", x, y, w, h });
  }

  useEffect(() => {
    if (!drag) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setDrag(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  // The overlay/capture children sit at z-20 / z-30 inside this layer's
  // own div. `fill=true` is the default — required when the wrapped content
  // is absolutely positioned (e.g. an iframe with transform: scale) because
  // otherwise this div would collapse to 0×0 and the absolute children
  // would cover nothing. `fill=false` lets the layer collapse to its
  // children's intrinsic size so a flex parent can center an `<img>`.
  return (
    <div
      ref={ref}
      className={clsx(
        "annotation-layer relative",
        fill ? "block size-full" : "inline-block",
      )}
    >
      {children}
      <div
        className="annotation-layer__overlay pointer-events-none absolute inset-0 z-20"
        aria-hidden
      >
        {annotations.map((a) => (
          <AnnotationMark
            key={a.id}
            annotation={a}
            highlighted={highlightId === a.id}
            onMouseEnter={() => onAnnotationHover(a.id)}
            onMouseLeave={() => onAnnotationHover(null)}
          />
        ))}
        {pending ? <AnnotationMark annotation={pending} pending /> : null}
      </div>
      {mode !== "off" ? (
        <div
          className="annotation-layer__capture absolute inset-0 z-30 cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {drag ? (
            <DragRect
              x={Math.min(drag.x, drag.cx)}
              y={Math.min(drag.y, drag.cy)}
              w={Math.abs(drag.cx - drag.x)}
              h={Math.abs(drag.cy - drag.y)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AnnotationMark({
  annotation,
  pending = false,
  highlighted = false,
  onMouseEnter,
  onMouseLeave,
}: {
  annotation: Annotation | CommentAnnotation;
  pending?: boolean;
  highlighted?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const indexLabel = "index" in annotation ? annotation.index : null;
  const dashClass = pending ? "annotation-dash--pending" : "annotation-dash";

  if (annotation.type === "point") {
    // Native size 100x100; placed centered on the annotation's unit coords.
    return (
      <div
        className="annotation-mark annotation-mark--point absolute"
        style={{
          left: `${annotation.x * 100}%`,
          top: `${annotation.y * 100}%`,
          width: 100,
          height: 100,
          transform: "translate(-50%, -50%)",
          pointerEvents: pending ? "none" : "auto",
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <svg
          className="absolute inset-0"
          viewBox="0 0 100 100"
          style={{ overflow: "visible" }}
        >
          <g className="annotation-pulse">
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="none"
              strokeWidth={2}
              strokeDasharray="10 10"
              className={dashClass}
            />
          </g>
        </svg>
        {indexLabel !== null ? (
          <span
            className={clsx(
              "annotation-mark__index pointer-events-none absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold shadow ring-2 ring-white",
              highlighted ? "bg-rose-500 text-white" : "bg-slate-900 text-white",
            )}
          >
            {indexLabel}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="annotation-mark annotation-mark--rect absolute"
      style={{
        left: `${annotation.x * 100}%`,
        top: `${annotation.y * 100}%`,
        width: `${annotation.w * 100}%`,
        height: `${annotation.h * 100}%`,
        pointerEvents: pending ? "none" : "auto",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <svg
        className="absolute inset-0 size-full"
        preserveAspectRatio="none"
        style={{ overflow: "visible" }}
      >
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="none"
          strokeWidth={2}
          strokeDasharray="10 10"
          className={dashClass}
        />
      </svg>
      {indexLabel !== null ? (
        <span
          className={clsx(
            "annotation-mark__index pointer-events-none absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full text-[10px] font-semibold shadow ring-2 ring-white",
            highlighted ? "bg-rose-500 text-white" : "bg-slate-900 text-white",
          )}
        >
          {indexLabel}
        </span>
      ) : null}
    </div>
  );
}

function DragRect({
  x,
  y,
  w,
  h,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  return (
    <div
      className="annotation-mark annotation-mark--drag pointer-events-none absolute"
      style={{
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: `${w * 100}%`,
        height: `${h * 100}%`,
      }}
    >
      <svg
        className="absolute inset-0 size-full"
        preserveAspectRatio="none"
        style={{ overflow: "visible" }}
      >
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="none"
          strokeWidth={2}
          strokeDasharray="10 10"
          className="annotation-dash--pending"
        />
      </svg>
    </div>
  );
}
