"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";
import {
  GIF_PALETTES,
  IMAGE_FORMATS,
  IMAGE_FORMAT_LABELS,
  formatOfFilename,
  isConvertibleImage,
  parseGifColors,
  parseJpgQuality,
  withImageFormat,
  type ImageEncoding,
  type ImageFormat,
} from "@/lib/image-formats";
import {
  VIDEO_FORMATS,
  VIDEO_FORMAT_LABELS,
  isConvertibleVideo,
  withVideoFormat,
  type VideoFormat,
} from "@/lib/video-formats";
import { fetchMatrixDownload } from "./matrix-download";
import type { DialogItem } from "./ShareDetailDialog";

// The share viewer's Download, as a menu: the original file, or the picture
// converted to JPG / PNG / WebP / AVIF (server-side — see lib/image-convert.ts).
// One menu for the detail dialog, the cards and Download all.
//
// The panel is portalled to <body> with fixed coordinates: a card is
// `overflow-hidden`, and a panel inside it would be cut off at its edge.

const JPG_QUALITY_KEY = "mm6_share_jpg_quality";
const GIF_COLORS_KEY = "mm6_share_gif_colors";

export function saveHref(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  saveHref(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stopActivationKeys(e: React.KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
}

export function DownloadMenu({
  label,
  className,
  triggerClassName,
  iconClassName = "size-3",
  busy = false,
  disabled = false,
  title,
  children,
}: {
  label: React.ReactNode;
  className?: string;
  triggerClassName: string;
  iconClassName?: string;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Below the trigger, right-aligned to it; above it when the space below
  // would not hold the panel (a card on the last row of the page).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    // clientWidth, not innerWidth: `right` on a fixed box counts from the
    // viewport's edge without the scrollbar, and innerWidth includes it — the
    // panel sat a scrollbar's width left of the button on a long share.
    const r = triggerRef.current.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const right = clientWidth - r.right;
    setPos(
      clientHeight - r.bottom < 280
        ? { right, bottom: clientHeight - r.top + 4 }
        : { right, top: r.bottom + 4 },
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    // Escape closes the menu only — the detail dialog behind it listens on
    // window, which this document listener runs before.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    }
    // Fixed coordinates do not follow the page; close rather than float off.
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    // Its own handler: a resize's target is the window, not a Node, and
    // `contains(window)` throws — the menu stayed open over a rotated phone.
    function onResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <div
      className={clsx("download-menu", className)}
      // The cards open the detail dialog on click and on Enter/Space; nothing
      // done in this menu is meant for them. React bubbles through the portal.
      // Other keys pass — Escape still has to reach the dialog behind.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={stopActivationKeys}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={clsx("download-menu__trigger", triggerClassName)}
      >
        {busy ? (
          <Icon name="spinner" className={clsx(iconClassName, "animate-spin")} />
        ) : (
          <Icon name="download" className={iconClassName} />
        )}
        {label}
        <Icon
          name="chevron-down"
          className={clsx(iconClassName, "opacity-60 transition", open && "rotate-180")}
        />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              style={pos}
              className="download-menu__panel fixed z-[60] w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={stopActivationKeys}
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuRow({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="download-menu__row flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:py-1.5 sm:text-xs"
    >
      {children}
    </button>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="download-menu__label px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

export function MenuDivider() {
  return <div className="download-menu__divider my-1 border-t border-slate-100" />;
}

// Only ever rendered in an open menu, i.e. in the browser after a click —
// never during SSR, so reading storage in the initializer is safe.
function useStoredKnob(key: string, parse: (raw: string | null) => number) {
  const [value, setValue] = useState(() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  });
  function change(raw: string) {
    const v = parse(raw);
    setValue(v);
    try {
      localStorage.setItem(key, String(v));
    } catch {}
  }
  return [value, change] as const;
}

/**
 * "as JPG [70] %", "as PNG", "as WebP", "as AVIF", "as GIF [256] colors" —
 * minus the format the file already is. JPG takes a quality and GIF a palette
 * size (user decisions, 2026-10-21), each remembered per viewer. The rows
 * mount when a menu opens, so every menu shows the value last set in any of
 * them.
 */
export function ImageFormatRows({
  exclude = null,
  onPick,
}: {
  exclude?: ImageFormat | null;
  onPick: (as: ImageFormat, enc: ImageEncoding) => void;
}) {
  const [jpgQuality, changeQuality] = useStoredKnob(JPG_QUALITY_KEY, parseJpgQuality);
  const [gifColors, changeColors] = useStoredKnob(GIF_COLORS_KEY, parseGifColors);
  const enc = { jpgQuality, gifColors };

  return (
    <>
      {IMAGE_FORMATS.filter((f) => f !== exclude).map((f) =>
        f === "jpg" ? (
          <div key={f} className="download-menu__jpg-row flex items-center pr-3 hover:bg-slate-50">
            <MenuRow onClick={() => onPick("jpg", enc)}>as JPG</MenuRow>
            <label className="download-menu__quality flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
              <input
                type="number"
                min={1}
                max={100}
                value={jpgQuality}
                onChange={(e) => changeQuality(e.target.value)}
                aria-label="JPG quality"
                className="w-11 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-[11px] text-slate-700 focus:border-slate-500 focus:outline-none"
              />
              %
            </label>
          </div>
        ) : f === "gif" ? (
          <div key={f} className="download-menu__gif-row flex items-center pr-3 hover:bg-slate-50">
            <MenuRow onClick={() => onPick("gif", enc)}>as GIF</MenuRow>
            <label className="download-menu__palette flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
              <select
                value={gifColors}
                onChange={(e) => changeColors(e.target.value)}
                aria-label="GIF palette size"
                className="custom-dropdown rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700 focus:border-slate-500 focus:outline-none"
              >
                {GIF_PALETTES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              colors
            </label>
          </div>
        ) : (
          <MenuRow key={f} onClick={() => onPick(f, enc)}>
            as {IMAGE_FORMAT_LABELS[f]}
          </MenuRow>
        ),
      )}
    </>
  );
}

const ITEM_TRIGGER =
  "toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100";

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function baseOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * A video's Download: "as Original MP4", then "as WebM". The WebM is encoded
 * on the server, ~30 s the first time (lib/video-convert.ts), and a plain link
 * would show nothing until the response began — so it is fetched here, with
 * the trigger saying so, and saved when it lands.
 */
function VideoDownloadMenu({ src, name }: { src: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function downloadAs(as: VideoFormat) {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch(withVideoFormat(src, as));
      if (!r.ok) {
        setFailed(true);
        return;
      }
      saveBlob(await r.blob(), `${baseOf(name)}.${as}`);
    } catch {
      // A dropped connection on a long encode: say so on the button.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DownloadMenu
      label={busy ? "Converting…" : failed ? "Conversion failed" : "Download"}
      busy={busy}
      disabled={busy}
      title={busy ? "Converting the video — this can take a minute" : undefined}
      triggerClassName={ITEM_TRIGGER}
    >
      {(close) => (
        <>
          <MenuRow
            onClick={() => {
              saveHref(src, name);
              close();
            }}
          >
            as Original {extOf(name).toUpperCase()}
          </MenuRow>
          {VIDEO_FORMATS.map((f) => (
            <MenuRow
              key={f}
              onClick={() => {
                close();
                void downloadAs(f);
              }}
            >
              as {VIDEO_FORMAT_LABELS[f]}
            </MenuRow>
          ))}
        </>
      )}
    </DownloadMenu>
  );
}

/**
 * One shared item's Download, worded like Download all: "as Original PNG"
 * (the format the file is), then the picture in the other formats. An MC
 * offers its HTML package first; its picture is the stored preview PNG
 * (`previewSrc`), so without one the menu offers the package alone. A video
 * offers WebM (VideoDownloadMenu). A WebM video, an HTML5 package or an SVG
 * has nothing to convert and stays a one-click Download.
 */
export function ItemDownloadMenu({
  item,
  shareId,
  previewSrc,
}: {
  item: DialogItem;
  shareId: string;
  previewSrc: string | null;
}) {
  if (item.kind === "creative") {
    const file = item.file;
    if (!file) return null;
    const name = item.creative.fileName ?? file.filename;
    const src = `/share/${shareId}/file/${file.id}`;
    const format = formatOfFilename(name);
    if (isConvertibleVideo(file.mimeType)) {
      return <VideoDownloadMenu src={src} name={name} />;
    }
    if (!isConvertibleImage(file.mimeType)) {
      return (
        <a
          href={src}
          download={name}
          onClick={(e) => e.stopPropagation()}
          className={ITEM_TRIGGER}
        >
          <Icon name="download" className="size-3" />
          Download
        </a>
      );
    }
    return (
      <DownloadMenu label="Download" triggerClassName={ITEM_TRIGGER}>
        {(close) => (
          <>
            <MenuRow
              onClick={() => {
                saveHref(src, name);
                close();
              }}
            >
              as Original {format ? IMAGE_FORMAT_LABELS[format] : extOf(name).toUpperCase()}
            </MenuRow>
            <ImageFormatRows
              exclude={format}
              onPick={(as, enc) => {
                saveHref(withImageFormat(src, as, enc), `${baseOf(name)}.${as}`);
                close();
              }}
            />
          </>
        )}
      </DownloadMenu>
    );
  }

  const base = `MC${item.message.number}${item.message.variant}-${item.size}`;
  async function downloadPackage() {
    if (item.kind !== "matrix") return;
    const { blob, filename } = await fetchMatrixDownload(shareId, item.message, item.size);
    if (blob) saveBlob(blob, filename);
  }
  return (
    <DownloadMenu label="Download" triggerClassName={ITEM_TRIGGER}>
      {(close) => (
        <>
          <MenuRow
            onClick={() => {
              void downloadPackage();
              close();
            }}
          >
            as HTML package
          </MenuRow>
          {previewSrc ? (
            <>
              <MenuDivider />
              <MenuRow
                onClick={() => {
                  saveHref(previewSrc, `${base}.png`);
                  close();
                }}
              >
                as Original PNG
              </MenuRow>
              <ImageFormatRows
                exclude="png"
                onPick={(as, enc) => {
                  saveHref(withImageFormat(previewSrc, as, enc), `${base}.${as}`);
                  close();
                }}
              />
            </>
          ) : null}
        </>
      )}
    </DownloadMenu>
  );
}

export type BulkDownload =
  | { mode: "html" }
  // `as: null` = the original pictures; a conversion always carries its knobs.
  | { mode: "image"; as: null }
  | { mode: "image"; as: ImageFormat; enc: ImageEncoding }
  // Every convertible video in `as`; everything else as "as Original" gives it.
  | { mode: "video"; as: VideoFormat };

/**
 * Download all's rows. With MCs in the list: "as HTML packages", then the
 * preview images under their own label. Without them the pictures are the
 * creatives themselves, and the label would only repeat the button.
 * `originalFormats` names what the original pictures are ("as Original PNG",
 * "as Original PNG · JPG"), `videoFormats` what the videos are ("MP4"). When
 * the pictures are all in one format, the row that would produce the same
 * files again is left out; when mixed, every row converts something, so all
 * stay. The picture formats show only when there is a picture to convert
 * (`pictureCount`), the video formats only when there is a video
 * (`videoCount`) — under their own label when pictures or MCs share the list.
 */
export function BulkDownloadRows({
  hasMatrix,
  imageCount,
  originalFormats,
  pictureCount,
  videoCount,
  videoFormats,
  onPick,
}: {
  hasMatrix: boolean;
  imageCount: number;
  originalFormats: ImageFormat[] | null;
  pictureCount: number;
  videoCount: number;
  videoFormats: string[];
  onPick: (choice: BulkDownload) => void;
}) {
  return (
    <>
      {hasMatrix ? (
        <>
          <MenuRow onClick={() => onPick({ mode: "html" })}>as HTML packages</MenuRow>
          <MenuDivider />
          <MenuLabel>Preview images · {imageCount}</MenuLabel>
        </>
      ) : null}
      <MenuRow
        disabled={imageCount === 0}
        onClick={() => onPick({ mode: "image", as: null })}
      >
        as Original
        {originalFormats &&
        originalFormats.length + videoFormats.length > 0
          ? ` ${[...originalFormats.map((f) => IMAGE_FORMAT_LABELS[f]), ...videoFormats].join(" · ")}`
          : ""}
      </MenuRow>
      {pictureCount > 0 ? (
        <ImageFormatRows
          exclude={originalFormats?.length === 1 ? originalFormats[0] : null}
          onPick={(as, enc) => onPick({ mode: "image", as, enc })}
        />
      ) : null}
      {videoCount > 0 ? (
        <>
          {hasMatrix || pictureCount > 0 ? (
            <>
              <MenuDivider />
              <MenuLabel>Videos · {videoCount}</MenuLabel>
            </>
          ) : null}
          {VIDEO_FORMATS.map((f) => (
            <MenuRow key={f} onClick={() => onPick({ mode: "video", as: f })}>
              as {VIDEO_FORMAT_LABELS[f]}
            </MenuRow>
          ))}
        </>
      ) : null}
    </>
  );
}
