"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/app/_icons/Icon";

function parseSize(size: string | null | undefined): { w: number; h: number } | null {
  const m = size?.match(/^(\d+)x(\d+)$/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

/**
 * A live, uploaded HTML5 package — the counterpart of MatrixIframePreview for a
 * creative that is a fixed bundle rather than a template render. Same layout
 * modes and lazy mount: "fill-width" (masonry: full width, banner aspect) and
 * "fit-rect" (fills a fixed box, letterboxed), rendered at native size and
 * transform-scaled.
 *
 * The frame loads by URL, never srcDoc, so the package's relative assets
 * resolve under it; and it is sandboxed WITHOUT allow-same-origin — the package
 * is foreign code, and an opaque origin keeps it away from the page and the
 * viewer's session (the entry routes send the same sandbox as a CSP).
 *
 * `interactive` drops the click shield, for the detail views where clicking
 * through to the landing page is the point. Changing `restartKey` reloads it.
 */
export function Html5PackageFrame({
  src,
  size,
  mode,
  title,
  interactive = false,
  restartKey = 0,
}: {
  src: string | null;
  size: string | null | undefined;
  mode: "fill-width" | "fit-rect";
  title: string;
  interactive?: boolean;
  restartKey?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [visible, setVisible] = useState(false);
  const native = parseSize(size);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      // LAST entry — see MatrixIframeRender: entries[0] can be a stale false.
      (entries) => setVisible(entries[entries.length - 1]?.isIntersecting === true),
      { rootMargin: "300px" },
    );
    io.observe(el);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const scale =
    native && box.w > 0
      ? mode === "fill-width" || box.h === 0
        ? Math.min(1, box.w / native.w)
        : Math.min(1, box.w / native.w, box.h / native.h)
      : 0;

  return (
    <div
      ref={wrapRef}
      className={
        mode === "fill-width"
          ? "html5-package-frame thumb-checker relative w-full overflow-hidden"
          : "html5-package-frame thumb-checker relative size-full overflow-hidden"
      }
      // Computed: the banner's own aspect, so masonry sizes the tile before load.
      style={mode === "fill-width" && native ? { aspectRatio: `${native.w} / ${native.h}` } : undefined}
    >
      {!native ? (
        <div className="html5-package-frame__placeholder flex size-full min-h-24 items-center justify-center text-[10px] text-slate-400">
          HTML5 · unknown size
        </div>
      ) : visible && src && scale > 0 ? (
        <>
          <iframe
            key={restartKey}
            title={title}
            src={src}
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            className="html5-package-frame__frame absolute block border-0"
            // Computed: native size, scaled and centred into the measured box.
            style={{
              width: native.w,
              height: native.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              left: mode === "fit-rect" ? (box.w - native.w * scale) / 2 : 0,
              top: mode === "fit-rect" && box.h > 0 ? (box.h - native.h * scale) / 2 : 0,
            }}
          />
          {interactive ? null : (
            <div className="html5-package-frame__click-shield absolute inset-0 z-10" aria-hidden />
          )}
        </>
      ) : (
        <div className="html5-package-frame__placeholder flex size-full items-center justify-center text-slate-300">
          <Icon name="code" className="size-6" />
        </div>
      )}
    </div>
  );
}

/**
 * The signed-in app's package frame: asks the server for the package's signed
 * /pkg link (the secret stays server-side) and frames it. By file id (library)
 * or by filename (a matrix cell's image1 knows only the name).
 */
export function LibraryPackageFrame({
  fileId,
  filename,
  ...frame
}: { fileId?: string | null; filename?: string | null } & Omit<
  Parameters<typeof Html5PackageFrame>[0],
  "src"
>) {
  const urlQ = usePackageUrl(fileId, filename);
  return (
    <Html5PackageFrame
      {...frame}
      size={frame.size ?? urlQ.data?.dimensions}
      src={urlQ.data?.url ?? null}
    />
  );
}

// One query for every package surface, so a frame and a poster of the same
// file share the cache entry (and its shape — see the query-key contract).
function usePackageUrl(fileId?: string | null, filename?: string | null) {
  const query = fileId
    ? `fileId=${encodeURIComponent(fileId)}`
    : `filename=${encodeURIComponent(filename ?? "")}`;
  return useQuery({
    queryKey: ["files", "package-url", query],
    queryFn: async () => {
      const r = await fetch(`/api/files/package-url?${query}`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return (await r.json()) as { fileId: string; url: string; dimensions: string | null };
    },
    enabled: !!(fileId || filename),
    // The link is stable for a file id until the secret rotates.
    staleTime: Infinity,
  });
}

/**
 * A package's poster where only its NAME is known — a matrix cell's image1 in
 * the editor's media field or the detail dialog's asset rows. Those used to put
 * /api/drive/proxy/<name> in an <img>, which for a zip is a broken image.
 */
export function PackagePoster({
  filename,
  width,
  className,
}: {
  filename: string;
  width: 80 | 200 | 400 | 800;
  className?: string;
}) {
  const urlQ = usePackageUrl(null, filename);
  if (!urlQ.data) {
    return (
      <div className="package-poster package-poster--pending flex size-full items-center justify-center text-slate-300">
        <Icon name="code" className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/files/${urlQ.data.fileId}/thumbnail?w=${width}`}
      alt={filename}
      className={className ?? "package-poster size-full object-contain"}
      loading="lazy"
    />
  );
}
