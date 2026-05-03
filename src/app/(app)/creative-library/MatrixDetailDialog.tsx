"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Grid as GridIcon,
  X,
  ExternalLink,
} from "lucide-react";
import clsx from "clsx";
import { usePersistent, type Codec } from "../_components/usePersistent";
import type { Message } from "../matrix/types";

type PreviewBg = "light" | "dark" | "checker";

const PREVIEW_BG_CODEC: Codec<PreviewBg> = {
  parse: (s) => (s === "light" || s === "dark" || s === "checker" ? s : "checker"),
  stringify: (v) => v,
};

export type MatrixNavItem = {
  id: number;
  message: Message;
  liveSize: string;
  liveTemplateName: string;
  product: string | null;
};

// Stepper walks the FULL filtered library list (matrix + uploaded), so that
// next/prev across mixed kinds matches the visible grid order. The parent
// swaps the dialog component when the next id is a different kind.
type NavRef = { id: number };

function parseSize(size: string): { w: number; h: number; landscape: boolean } {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return { w: 300, h: 250, landscape: false };
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  return { w, h, landscape: w > h };
}

// Matches MediaEntityDialog's modal shell so matrix items feel like the
// uploaded creative preview: backdrop + 90vw rounded card, draggable two-pane
// (info form left, scaled iframe preview right), prev/next stepper across
// the filtered matrix items, bg toggle, ESC + arrow keys.
export default function MatrixDetailDialog({
  item,
  navItems,
  onJump,
  onClose,
}: {
  item: MatrixNavItem;
  navItems: NavRef[];
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  const [bg, setBg] = usePersistent<PreviewBg>(
    "mm6_media_dialog_preview_bg",
    "checker",
    PREVIEW_BG_CODEC,
  );
  const [splitPercent, setSplitPercent] = useState<number>(60);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);
  const dims = useMemo(() => parseSize(item.liveSize), [item.liveSize]);
  const wide = dims.landscape;

  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    setHtml(null);
    let cancelled = false;
    fetch("/api/render", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName: item.liveTemplateName,
        size: item.liveSize,
        message: item.message,
        inline: true,
        skipAnimations: false,
      }),
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
  }, [item.id, item.message.version, item.liveSize, item.liveTemplateName]);

  const navIndex = useMemo(
    () => navItems.findIndex((x) => x.id === item.id),
    [navItems, item.id],
  );
  function navigatePrev() {
    if (navIndex > 0) onJump(navItems[navIndex - 1]!.id);
  }
  function navigateNext() {
    if (navIndex >= 0 && navIndex < navItems.length - 1) {
      onJump(navItems[navIndex + 1]!.id);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") navigatePrev();
      if (e.key === "ArrowRight") navigateNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = wide ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }
  useEffect(() => {
    function onMove(ev: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let pct: number;
      if (wide) {
        pct = ((ev.clientY - rect.top) / rect.height) * 100;
      } else {
        pct = ((rect.right - ev.clientX) / rect.width) * 100;
      }
      setSplitPercent(Math.max(20, Math.min(80, pct)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [wide]);

  const m = item.message;
  const mcLabel = `MC${m.number}${m.variant ?? ""}`;
  const title = mcLabel;
  const subtitle = m.headline ?? m.name ?? null;

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={clsx(
          "media-entity-dialog matrix-detail-dialog modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl",
          wide && "media-entity-dialog--landscape",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="media-entity-dialog__header modal__header flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
          <button
            onClick={navigatePrev}
            disabled={navIndex <= 0}
            aria-label="Previous"
            className="media-entity-dialog__nav-prev rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="media-entity-dialog__title-block flex min-w-0 items-baseline gap-2">
            <span
              className="media-entity-dialog__title truncate font-mono text-sm font-semibold text-slate-900"
              title={title}
            >
              {title}
            </span>
            {subtitle ? (
              <span className="media-entity-dialog__subtitle truncate text-xs text-slate-500">
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            onClick={navigateNext}
            disabled={navIndex < 0 || navIndex >= navItems.length - 1}
            aria-label="Next"
            className="media-entity-dialog__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
          {navItems.length > 0 ? (
            <span className="media-entity-dialog__nav-counter text-xs text-slate-500">
              {navIndex + 1}/{navItems.length}
            </span>
          ) : null}
          {m.status ? (
            <span className="status-badge ml-2 inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
              {m.status}
            </span>
          ) : null}

          <div className="media-entity-dialog__header-actions ml-auto flex items-center gap-2">
            <Link
              href={`/matrix?msg=${m.id}`}
              className="toolbar-btn flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              title="Open in matrix editor"
            >
              <ExternalLink className="size-3.5" />
              Open in matrix
            </Link>
            <button
              onClick={onClose}
              aria-label="Close"
              className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>

        <div
          ref={containerRef}
          className={clsx(
            "media-entity-dialog__body flex flex-1 overflow-hidden",
            wide ? "flex-col" : "flex-row",
          )}
        >
          <section
            className="media-entity-dialog__pane--form flex flex-col overflow-hidden bg-white"
            style={{
              order: wide ? 3 : 1,
              flexBasis: `${100 - splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <div className="media-entity-dialog__form-content flex-1 overflow-y-auto px-5 py-4 text-xs">
              <MatrixInfoBlock item={item} />
            </div>
          </section>

          <div
            onMouseDown={startDrag}
            className={clsx(
              "divider-handle shrink-0 bg-slate-200 transition-colors hover:bg-slate-400",
              wide
                ? "divider-handle--horizontal h-1 w-full cursor-row-resize"
                : "divider-handle--vertical h-full w-1 cursor-col-resize",
            )}
            style={{ order: 2 }}
            title="Drag to resize"
          />

          <section
            className="media-entity-dialog__pane--preview flex flex-col overflow-hidden"
            style={{
              order: wide ? 1 : 3,
              flexBasis: `${splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <div className="media-entity-dialog__preview-toolbar flex h-10 shrink-0 items-center justify-end gap-1 border-b border-slate-200 bg-white px-3">
              <span className="mr-auto text-[11px] text-slate-500">{item.liveSize}</span>
              <div className="bg-toggle flex overflow-hidden rounded border border-slate-300">
                <BgBtn active={bg === "light"} onClick={() => setBg("light")} title="Light background">
                  <Sun className="size-3.5" />
                </BgBtn>
                <BgBtn active={bg === "checker"} onClick={() => setBg("checker")} title="Checker background">
                  <GridIcon className="size-3.5" />
                </BgBtn>
                <BgBtn active={bg === "dark"} onClick={() => setBg("dark")} title="Dark background">
                  <Moon className="size-3.5" />
                </BgBtn>
              </div>
            </div>
            <PreviewStage
              html={html}
              nativeW={dims.w}
              nativeH={dims.h}
              bg={bg}
              title={`${mcLabel} ${item.liveSize}`}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function PreviewStage({
  html,
  nativeW,
  nativeH,
  bg,
  title,
}: {
  html: string | null;
  nativeW: number;
  nativeH: number;
  bg: PreviewBg;
  title: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
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
      ? Math.min(1, (box.w - margin * 2) / nativeW, (box.h - margin * 2) / nativeH)
      : 0;

  return (
    <div
      ref={stageRef}
      className="media-entity-dialog__preview-viewport flex flex-1 items-center justify-center overflow-hidden p-4"
      style={bgStyleFor(bg)}
    >
      {html === null ? (
        <div className="text-xs text-slate-400">loading…</div>
      ) : html === "" ? (
        <div className="text-xs text-rose-500">render failed</div>
      ) : (
        <div
          style={{
            width: nativeW,
            height: nativeH,
            transform: scale > 0 ? `scale(${scale})` : undefined,
            transformOrigin: "center center",
            flexShrink: 0,
          }}
        >
          <iframe
            title={title}
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            className="block size-full border-0 bg-white"
          />
        </div>
      )}
    </div>
  );
}

function MatrixInfoBlock({ item }: { item: MatrixNavItem }) {
  const m = item.message;
  const rows: Array<[string, ReactNode]> = [
    ["MC", `MC${m.number}${m.variant ?? ""}`],
    ["Status", m.status ?? "—"],
    ["Audience", m.audience],
    ["Topic", m.topic],
    ["Product", item.product ?? "—"],
    ["Template", m.template ?? "—"],
    ["Size", item.liveSize],
    ["Headline", m.headline ?? "—"],
    ["Copy 1", m.copy1 ?? "—"],
    ["Copy 2", m.copy2 ?? "—"],
    ["Disclaimer", m.disclaimer ?? "—"],
    ["CTA", m.cta ?? "—"],
    ["Landing URL", m.landingUrl ?? "—"],
    ["Start", m.startDate ?? "—"],
    ["End", m.endDate ?? "—"],
    ["Updated", m.updatedAt],
  ];
  const assetSlots: Array<[string, string | null, "image" | "video"]> = [
    ["Image 1", m.image1, "image"],
    ["Image 2", m.image2, "image"],
    ["Image 3", m.image3, "image"],
    ["Image 4", m.image4, "image"],
    ["Image 5", m.image5, "image"],
    ["Image 6", m.image6, "image"],
    ["Video 1", m.video1, "video"],
  ];
  const presentAssets = assetSlots.filter(([, id]) => !!id);
  return (
    <>
      <dl className="matrix-detail-dialog__info grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {rows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </dl>
      {presentAssets.length > 0 ? (
        <div className="matrix-detail-dialog__assets mt-4 border-t border-slate-100 pt-3">
          <div className="matrix-detail-dialog__assets-title mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Assets
          </div>
          <div className="matrix-detail-dialog__assets-grid grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            {presentAssets.map(([label, name, kind]) => (
              <AssetRow key={label} label={label} filename={name!} kind={kind} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function AssetRow({
  label,
  filename,
  kind,
}: {
  label: string;
  filename: string;
  kind: "image" | "video";
}) {
  const src = `/api/drive/proxy/${encodeURIComponent(filename)}`;
  return (
    <>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="matrix-detail-dialog__asset-row flex items-center gap-2">
        <div className="thumb-checker size-12 shrink-0 overflow-hidden rounded border border-slate-200">
          {kind === "image" ? (
            <img
              src={src}
              alt={label}
              className="size-full object-contain"
              loading="lazy"
            />
          ) : (
            <video
              src={`${src}#t=0.1`}
              className="size-full object-contain"
              preload="metadata"
              muted
              playsInline
            />
          )}
        </div>
        <span className="font-mono text-[11px] text-slate-500" title={filename}>
          {filename}
        </span>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value}</dd>
    </>
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
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "bg-toggle__btn flex items-center justify-center px-1.5 py-1 transition-colors",
        active
          ? "bg-toggle__btn--active bg-slate-900 text-white"
          : "bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function bgStyleFor(bg: PreviewBg): React.CSSProperties {
  if (bg === "dark") return { backgroundColor: "#1f2937" };
  if (bg === "checker") {
    return {
      backgroundColor: "#f9fafb",
      backgroundImage:
        "linear-gradient(45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(-45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(45deg, transparent 75%, #d1d5db 75%), " +
        "linear-gradient(-45deg, transparent 75%, #d1d5db 75%)",
      backgroundSize: "20px 20px",
      backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
    };
  }
  return { backgroundColor: "#ffffff" };
}
