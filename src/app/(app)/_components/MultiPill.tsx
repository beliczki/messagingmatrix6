"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  values: Set<string>;
  options: string[];
  onChange: (s: Set<string>) => void;
  // Optional per-option color (Tailwind bg-* class) shown as a leading dot —
  // used by the Status filter to tint each option with its status color.
  optionColors?: Record<string, string>;
};

export default function MultiPill({
  label,
  values,
  options,
  onChange,
  optionColors,
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
