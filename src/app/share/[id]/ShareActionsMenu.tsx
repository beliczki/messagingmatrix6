"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Columns3,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Moon,
  Sun,
} from "lucide-react";
import clsx from "clsx";
import GoogleDriveIcon from "@/app/_components/GoogleDriveIcon";
import { useThemeSwitch } from "@/app/_components/useThemeSwitch";

// On a phone the action row wraps into three cramped lines of icon buttons with
// no labels. Here they live in one menu instead: full-width rows, each one
// saying what it does, grouped under the section it belongs to.

export type ViewMode = "grid" | "list" | "masonry";
export type DriveFolder = { id: string; name: string; mcs: string[] };

const VIEWS: Array<{ k: ViewMode; label: string; icon: React.ReactNode }> = [
  { k: "grid", label: "Grid", icon: <LayoutGrid className="size-4" /> },
  { k: "list", label: "List", icon: <ListIcon className="size-4" /> },
  { k: "masonry", label: "Masonry", icon: <Columns3 className="size-4" /> },
];

export default function ShareActionsMenu({
  className,
  view,
  setView,
  imagePreview,
  setImagePreview,
  canImagePreview,
  imageReadyCount,
  totalCount,
  downloadCount,
  zipping,
  zipProgress,
  onDownloadAll,
  driveFolders,
}: {
  className?: string;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  imagePreview: boolean;
  setImagePreview: (v: boolean) => void;
  canImagePreview: boolean;
  imageReadyCount: number;
  totalCount: number;
  downloadCount: number;
  zipping: boolean;
  zipProgress: number;
  onDownloadAll: () => void;
  driveFolders: DriveFolder[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { dark, setTheme } = useThemeSwitch();

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={clsx("share-actions-menu relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="share-actions-menu__trigger inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
      >
        Actions
        <ChevronDown
          className={clsx("size-4 text-slate-400 transition", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="share-actions-menu__panel absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          <Section label="Download">
            <Row
              onClick={() => {
                onDownloadAll();
                setOpen(false);
              }}
              disabled={zipping || downloadCount === 0}
              icon={
                zipping ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )
              }
            >
              {zipping
                ? `Bundling… ${zipProgress}%`
                : `Download all (${downloadCount})`}
            </Row>
          </Section>

          {driveFolders.length > 0 ? (
            <Section label={driveFolders.length > 1 ? "Drive folders" : "Drive"}>
              {driveFolders.map((f) => (
                <a
                  key={f.id}
                  href={`https://drive.google.com/drive/folders/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpen(false)}
                  className="share-actions-menu__row flex items-start gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <GoogleDriveIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {driveFolders.length > 1 ? f.name : "Google Drive"}
                    </span>
                    {driveFolders.length > 1 && f.mcs.length > 0 ? (
                      <span className="block truncate text-[11px] text-slate-500">
                        {f.mcs.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </a>
              ))}
            </Section>
          ) : null}

          <Section label="View">
            {VIEWS.map((o) => (
              <Row
                key={o.k}
                onClick={() => {
                  setView(o.k);
                  setOpen(false);
                }}
                icon={o.icon}
                active={view === o.k}
              >
                {o.label}
              </Row>
            ))}
          </Section>

          {canImagePreview ? (
            <Section label="Preview">
              <Row
                onClick={() => setImagePreview(!imagePreview)}
                icon={<ImageIcon className="size-4" />}
                active={imagePreview}
              >
                Image preview
                <span className="ml-auto text-[11px] text-slate-500">
                  {imageReadyCount}/{totalCount}
                </span>
              </Row>
            </Section>
          ) : null}

          <Section label="Theme">
            <Row
              onClick={(e) => setTheme(false, e)}
              icon={<Sun className="size-4" />}
              active={!dark}
            >
              Light
            </Row>
            <Row
              onClick={(e) => setTheme(true, e)}
              icon={<Moon className="size-4" />}
              active={dark}
            >
              Dark
            </Row>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="share-actions-menu__section border-b border-slate-100 py-1 last:border-b-0">
      <div className="share-actions-menu__section-label px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  onClick,
  icon,
  active = false,
  disabled = false,
  children,
}: {
  onClick: (e: React.MouseEvent) => void;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "share-actions-menu__row flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:opacity-50",
        active ? "font-medium text-slate-900" : "text-slate-700",
        !disabled && "hover:bg-slate-50",
      )}
    >
      {icon}
      {children}
      {active ? <Check className="ml-auto size-4 text-slate-900" /> : null}
    </button>
  );
}
