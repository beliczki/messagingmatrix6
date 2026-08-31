"use client";

import clsx from "clsx";
import { Check, Image as ImageIcon } from "lucide-react";

// Shared by the gallery toolbar and the detail dialog header so the two cannot
// drift apart visually — and, more importantly, so the single piece of state
// behind them (ShareGallery's `imagePreview`) has one control shape.
//
// `ready`/`total` are gallery-level: how many items have a stored preview. The
// dialog shows one item at a time and passes neither, which hides the count
// badge rather than printing a meaningless "1 of 1".

export default function ImagePreviewToggle({
  on,
  onChange,
  ready,
  total,
  compact = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ready?: number;
  total?: number;
  compact?: boolean;
}) {
  const hasCount = ready !== undefined && total !== undefined;
  const complete = hasCount && ready === total;
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      title={
        !hasCount
          ? "Show the stored preview image instead of the live render"
          : complete
            ? `All ${total} items have a stored preview image`
            : `${ready} of ${total} items have a stored preview image — the rest have no preview yet and stay out of the download`
      }
      className={clsx(
        "share-gallery__image-toggle inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition",
        on
          ? "share-gallery__image-toggle--active border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      <span
        className={clsx(
          "flex size-3.5 items-center justify-center rounded-sm border",
          on ? "border-white bg-white text-slate-900" : "border-slate-300",
        )}
      >
        {on ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <ImageIcon className="size-3.5" />
      {compact ? null : "Image preview"}
      {hasCount ? (
      <span
        className={clsx(
          "share-gallery__image-toggle-count rounded-full px-1.5 text-[10px] font-medium",
          complete
            ? on
              ? "bg-white/20 text-white"
              : "bg-slate-100 text-slate-600"
            : "bg-amber-100 text-amber-700",
        )}
      >
        {ready}
      </span>
      ) : null}
    </button>
  );
}
