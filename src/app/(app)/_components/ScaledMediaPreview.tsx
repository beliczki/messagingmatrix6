"use client";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";

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

  const isImage = mimeType?.startsWith("image/");
  const isVideo = mimeType?.startsWith("video/");
  const hasFile = !!fileId && (isImage || isVideo);
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
      className="scaled-preview flex size-full items-center justify-center overflow-hidden"
    >
      {!hasFile ? (
        <div className="flex size-full items-center justify-center text-slate-400">
          <ImageIcon className="size-12" />
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
          {isImage ? (
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
