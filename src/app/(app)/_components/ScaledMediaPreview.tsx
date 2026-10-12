"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/app/_icons/Icon";
import { creativeMediaKind } from "@/lib/creative-media-kind";
import { LibraryPackageFrame } from "./Html5PackageFrame";

// Renders a file thumbnail at its natural pixel size when the container has
// room, or transform-scales it down to fit. Mirrors PreviewPane's iframe
// scaling pattern so detail dialogs feel like the matrix MC editor preview.
export default function ScaledMediaPreview({
  fileId,
  mimeType,
  alt,
  naturalW,
  naturalH,
}: {
  fileId: string | null;
  mimeType: string | null | undefined;
  alt: string;
  naturalW: number | null;
  naturalH: number | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  const kind = creativeMediaKind(mimeType, alt);
  const isImage = kind === "image";
  const isVideo = kind === "video";
  const isPackage = kind === "html5";
  const hasFile = !!fileId && (isImage || isVideo || isPackage);
  // Bumped by the restart button: remounts the package's frame so its
  // animation plays again from the top.
  const [restartKey, setRestartKey] = useState(0);
  const knownDims = !!(naturalW && naturalH && naturalW > 0 && naturalH > 0);

  const margin = 16;
  const scale =
    knownDims && box.w > 0 && box.h > 0
      ? Math.min(
          1,
          (box.w - margin * 2) / naturalW!,
          (box.h - margin * 2) / naturalH!,
        )
      : 1;

  return (
    <div
      ref={boxRef}
      className="scaled-preview relative flex size-full items-center justify-center overflow-hidden"
    >
      {isPackage && hasFile ? (
        <button
          type="button"
          onClick={() => setRestartKey((k) => k + 1)}
          title="Play the HTML5 creative again from the start"
          className="scaled-preview__restart toolbar-btn absolute right-2 top-2 z-20 flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text-primary hover:bg-surface-alt"
        >
          <Icon name="refresh" className="size-3.5" />
          Restart
        </button>
      ) : null}
      {!hasFile ? (
        <div className="flex size-full items-center justify-center text-slate-400">
          <Icon name="image" className="size-12" />
        </div>
      ) : knownDims ? (
        <div
          style={{
            width: naturalW!,
            height: naturalH!,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: "center center",
            flexShrink: 0,
          }}
        >
          {isPackage ? (
            <LibraryPackageFrame
              fileId={fileId}
              size={`${naturalW}x${naturalH}`}
              mode="fit-rect"
              title={alt}
              interactive
              restartKey={restartKey}
            />
          ) : isImage ? (
            <img
              src={`/api/files/${fileId}/thumbnail?w=800`}
              alt={alt}
              className="size-full object-contain"
              loading="lazy"
            />
          ) : (
            <video
              src={`/api/files/${fileId}#t=0.1`}
              className="size-full object-contain"
              controls
              preload="metadata"
              muted
              playsInline
            />
          )}
        </div>
      ) : isPackage ? (
        // Validated packages always carry a size; one without cannot be framed.
        <LibraryPackageFrame fileId={fileId} size={null} mode="fit-rect" title={alt} interactive />
      ) : isImage ? (
        <img
          src={`/api/files/${fileId}/thumbnail?w=800`}
          alt={alt}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
        />
      ) : (
        <video
          src={`/api/files/${fileId}#t=0.1`}
          className="max-h-full max-w-full object-contain"
          controls
          preload="metadata"
          muted
          playsInline
        />
      )}
    </div>
  );
}

export function parseDimensions(s: string | null | undefined): {
  w: number | null;
  h: number | null;
  landscape: boolean;
} {
  if (!s) return { w: null, h: null, landscape: false };
  const m = s.match(/^(\d+)x(\d+)$/);
  if (!m) return { w: null, h: null, landscape: false };
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  return { w, h, landscape: w > h };
}
