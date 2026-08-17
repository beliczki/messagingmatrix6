"use client";

import { useEffect, useRef, useState } from "react";

// A quick-select link above the option list. `values` is either an explicit
// subset — clicking toggles it (adds when not all present, removes when it
// already is, so presets compose) — or one of three whole-list shorthands:
// "all" selects everything, "none" clears, "all-none" flips between the two.
export type QuickPreset = {
  label: string;
  values: string[] | "all" | "none" | "all-none";
};

// Shared by both Status pills (matrix toolbar + DimensionGrid).
export const STATUS_QUICK_SELECT = {
  prefix: "Select",
  presets: [
    { label: "all", values: "all" },
    { label: "none", values: "none" },
  ],
} satisfies { prefix?: string; presets: QuickPreset[] };

type Props = {
  label: string;
  values: Set<string>;
  options: string[];
  onChange: (s: Set<string>) => void;
  // Optional per-option color (Tailwind bg-* class) shown as a leading dot —
  // used by the Status filter to tint each option with its status color.
  optionColors?: Record<string, string>;
  // Optional quick-select row at the top of the menu. Omit for a plain list.
  quickSelect?: { prefix?: string; presets: QuickPreset[] };
};

export default function MultiPill({
  label,
  values,
  options,
  onChange,
  optionColors,
  quickSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  if (options.length === 0) return null;

  // A subset preset only lists sizes/values the current data actually has, so
  // a preset naming nothing present is dropped rather than rendered as a link
  // that visibly does nothing.
  const availableOf = (p: QuickPreset) =>
    Array.isArray(p.values) ? p.values.filter((v) => options.includes(v)) : [];
  const shownPresets = (quickSelect?.presets ?? []).filter(
    (p) => !Array.isArray(p.values) || availableOf(p).length > 0,
  );

  function applyPreset(p: QuickPreset): Set<string> {
    if (p.values === "all") return new Set(options);
    if (p.values === "none") return new Set();
    if (p.values === "all-none")
      return values.size > 0 ? new Set() : new Set(options);
    const avail = availableOf(p);
    const next = new Set(values);
    const isFull = avail.every((v) => values.has(v));
    for (const v of avail) {
      if (isFull) next.delete(v);
      else next.add(v);
    }
    return next;
  }

  return (
    <div ref={ref} className="multi-pill relative text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="multi-pill__button flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
      >
        <span>{label}</span>
        {values.size > 0 ? (
          <span className="multi-pill__badge rounded-full bg-slate-900 px-1.5 text-[10px] font-medium text-white">
            {values.size}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="multi-pill__menu absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
          {shownPresets.length > 0 ? (
            <div className="multi-pill__bulk mb-1 border-b border-slate-100 px-2 pb-1 text-[10px] text-slate-500">
              {quickSelect?.prefix ? `${quickSelect.prefix} ` : null}
              {shownPresets.map((p, i) => (
                <span key={p.label}>
                  {i > 0 ? " / " : null}
                  <button
                    type="button"
                    onClick={() => onChange(applyPreset(p))}
                    className="multi-pill__bulk-link underline hover:text-slate-900"
                  >
                    {p.label}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {options.map((opt) => {
            const checked = values.has(opt);
            return (
              <label
                key={opt}
                className="multi-pill__option flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-100"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(values);
                    if (e.target.checked) next.add(opt);
                    else next.delete(opt);
                    onChange(next);
                  }}
                />
                {optionColors ? (
                  <span
                    className={`multi-pill__dot size-2 shrink-0 rounded-full ${
                      optionColors[opt] ?? "bg-slate-300"
                    }`}
                  />
                ) : null}
                <span className="truncate">{opt}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
