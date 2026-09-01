"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";

export type BaselineChoice = {
  id: number;
  filename: string;
  platform: string;
  feedVersion: number;
  source: string;
  exportedAt: string;
  uploadedToAdformAt: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** What this feed is: uploaded reference vs our own export, and whether live. */
function kindOf(b: BaselineChoice): string {
  const kind =
    b.source === "adform_snapshot" ? "reference" : `export v${b.feedVersion}`;
  return b.uploadedToAdformAt ? `${kind} · live` : kind;
}

// A single-select popover rather than a native <select>, because each option
// carries three things worth reading separately — the filename, what the feed
// is (reference vs export, live or not) and when it went out. Popover mechanics
// (outside click, Escape, aria) follow MultiPill so the two behave alike.
export default function BaselinePicker({
  options,
  value,
  onChange,
}: {
  options: BaselineChoice[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const selected = options.find((o) => o.id === value) ?? null;

  if (options.length === 0) {
    return (
      <div className="baseline-picker baseline-picker--empty input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-500">
        No earlier feed for this product — this is the first export.
      </div>
    );
  }

  return (
    <div ref={ref} className="baseline-picker relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="baseline-picker__button input-box flex w-full items-center gap-2 rounded border border-slate-300 px-2 py-1.5 text-left text-xs hover:border-slate-400 focus:border-slate-500 focus:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="baseline-picker__name block truncate font-mono">
            {selected ? selected.filename : "Pick a feed to compare against"}
          </span>
          {selected ? (
            <span className="baseline-picker__meta block truncate text-[10px] text-slate-500">
              {kindOf(selected)}
              {selected.uploadedToAdformAt
                ? ` · ${formatDate(selected.uploadedToAdformAt)}`
                : ` · built ${formatDate(selected.exportedAt)}`}
            </span>
          ) : null}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="baseline-picker__menu absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg"
        >
          {options.map((o) => {
            const active = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={clsx(
                  "baseline-picker__option flex w-full items-start gap-2 rounded px-2 py-1.5 text-left",
                  active ? "bg-slate-100" : "hover:bg-slate-50",
                )}
              >
                <Check
                  className={clsx(
                    "mt-0.5 size-3 shrink-0",
                    active ? "text-slate-900" : "invisible",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">
                    {o.filename}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    {kindOf(o)}
                    {o.uploadedToAdformAt
                      ? ` · ${formatDate(o.uploadedToAdformAt)}`
                      : ` · built ${formatDate(o.exportedAt)}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
