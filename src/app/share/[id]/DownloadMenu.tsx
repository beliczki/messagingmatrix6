"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";
import {
  DEFAULT_JPG_QUALITY,
  IMAGE_FORMATS,
  IMAGE_FORMAT_LABELS,
  formatOfFilename,
  isConvertibleImage,
  parseJpgQuality,
  withImageFormat,
  type ImageFormat,
} from "@/lib/image-formats";
import { fetchMatrixDownload } from "./matrix-download";
import type { DialogItem } from "./ShareDetailDialog";

// The share viewer's Download, as a menu: the original file, or the picture
// converted to JPG / PNG / WebP / AVIF (server-side — see lib/image-convert.ts).
// One menu for the detail dialog, the cards and Download all.
//
// The panel is portalled to <body> with fixed coordinates: a card is
// `overflow-hidden`, and a panel inside it would be cut off at its edge.

const JPG_QUALITY_KEY = "mm6_share_jpg_quality";

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
    const r = triggerRef.current.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setPos(
      window.innerHeight - r.bottom < 280
        ? { right, bottom: window.innerHeight - r.top + 4 }
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
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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

/**
 * "as JPG [70] %", "as PNG", "as WebP", "as AVIF" — minus the format the file
 * already is. Only JPG takes a quality (user decision, 2026-10-21); it is
 * remembered per viewer. The rows mount when a menu opens, so every menu
 * shows the value last typed into any of them.
 */
export function ImageFormatRows({
  exclude = null,
  onPick,
}: {
  exclude?: ImageFormat | null;
  onPick: (as: ImageFormat, quality: number) => void;
}) {
  // Only ever rendered in an open menu, i.e. in the browser after a click —
  // never during SSR, so reading storage in the initializer is safe.
  const [quality, setQuality] = useState(() => {
    try {
      return parseJpgQuality(localStorage.getItem(JPG_QUALITY_KEY));
    } catch {
      return DEFAULT_JPG_QUALITY;
    }
  });
  function changeQuality(raw: string) {
    const q = parseJpgQuality(raw);
    setQuality(q);
    try {
      localStorage.setItem(JPG_QUALITY_KEY, String(q));
    } catch {}
  }

  return (
    <>
      {IMAGE_FORMATS.filter((f) => f !== exclude).map((f) =>
        f === "jpg" ? (
          <div key={f} className="download-menu__jpg-row flex items-center pr-3 hover:bg-slate-50">
            <MenuRow onClick={() => onPick("jpg", quality)}>as JPG</MenuRow>
            <label className="download-menu__quality flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
              <input
                type="number"
                min={1}
                max={100}
                value={quality}
                onChange={(e) => changeQuality(e.target.value)}
                aria-label="JPG quality"
                className="w-11 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-[11px] text-slate-700 focus:border-slate-500 focus:outline-none"
              />
              %
            </label>
          </div>
        ) : (
          <MenuRow key={f} onClick={() => onPick(f, quality)}>
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
 * One shared item's Download. Original first, with its real extension, then
 * the picture in the other formats. An MC's original is its HTML package; its
 * picture is the stored preview PNG (`previewSrc`), so without one the menu
 * offers the package alone. A video, an HTML5 package or an SVG has nothing to
 * convert and stays a one-click Download.
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
              Original <span className="text-slate-400">(.{extOf(name)})</span>
            </MenuRow>
            <ImageFormatRows
              exclude={formatOfFilename(name)}
              onPick={(as, q) => {
                saveHref(withImageFormat(src, as, q), `${baseOf(name)}.${as}`);
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
            Original <span className="text-slate-400">(.zip)</span>
          </MenuRow>
          {previewSrc ? (
            <ImageFormatRows
              onPick={(as, q) => {
                saveHref(withImageFormat(previewSrc, as, q), `${base}.${as}`);
                close();
              }}
            />
          ) : null}
        </>
      )}
    </DownloadMenu>
  );
}

export type BulkDownload =
  | { mode: "html" }
  | { mode: "image"; as: ImageFormat | null; quality: number };

/**
 * Download all's rows: "as HTML packages" when there are MCs to package, then
 * the preview images — the original pictures, or converted. Shared with the
 * phone's Actions menu.
 */
export function BulkDownloadRows({
  hasMatrix,
  htmlCount,
  imageCount,
  onPick,
}: {
  hasMatrix: boolean;
  htmlCount: number;
  imageCount: number;
  onPick: (choice: BulkDownload) => void;
}) {
  return (
    <>
      {hasMatrix ? (
        <>
          <MenuRow onClick={() => onPick({ mode: "html" })}>
            as HTML packages
            <span className="ml-auto text-[10px] text-slate-400">{htmlCount}</span>
          </MenuRow>
          <MenuDivider />
        </>
      ) : null}
      <MenuLabel>Preview images · {imageCount}</MenuLabel>
      <MenuRow
        disabled={imageCount === 0}
        onClick={() => onPick({ mode: "image", as: null, quality: 0 })}
      >
        Original
      </MenuRow>
      {imageCount > 0 ? (
        <ImageFormatRows onPick={(as, quality) => onPick({ mode: "image", as, quality })} />
      ) : null}
    </>
  );
}
