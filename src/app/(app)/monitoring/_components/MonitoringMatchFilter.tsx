"use client";

import clsx from "clsx";
import { Link2, List, Unlink2 } from "lucide-react";
import type { MatchFilter } from "./MonitoringTable";

const OPTIONS: Array<{ key: MatchFilter; label: string; Icon: typeof List }> = [
  { key: "all", label: "All", Icon: List },
  { key: "matched", label: "Matched", Icon: Link2 },
  { key: "unmatched", label: "Unmatched", Icon: Unlink2 },
];

/**
 * Whether the table shows rows the importer could link to a matrix cell.
 *
 * Lives in the right toolbar rather than the header: it is a view mode, like
 * the library view switcher and the archive toggle that sit there on the other
 * screens, not a filter over the current period's contents.
 */
export default function MonitoringMatchFilter({
  value,
  onChange,
  collapsed = false,
}: {
  value: MatchFilter;
  onChange: (m: MatchFilter) => void;
  collapsed?: boolean;
}) {
  // Collapsed the rail is 48px wide, so the three options become icons — the
  // same trade the view switcher and archive toggle make on this rail.
  if (collapsed) {
    return (
      <div className="monitoring-match-filter monitoring-match-filter--collapsed flex flex-col items-center gap-1">
        {OPTIONS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={label}
            aria-label={label}
            aria-pressed={value === key}
            className={clsx(
              "monitoring-match-filter__option inline-flex size-9 items-center justify-center rounded-md transition",
              value === key
                ? "monitoring-match-filter__option--active bg-slate-900 text-white"
                : "toolbar-btn text-slate-500 hover:bg-slate-100",
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="monitoring-match-filter flex flex-col gap-1.5">
      <div className="monitoring-match-filter__header text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Rows
      </div>
      <div className="monitoring-match-filter__group inline-flex overflow-hidden rounded border border-slate-300 text-xs">
        {OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={clsx(
              "monitoring-match-filter__option flex-1 px-2 py-1 font-medium transition",
              value === key
                ? "monitoring-match-filter__option--active bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
