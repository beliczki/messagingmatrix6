"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import clsx from "clsx";

type Props = {
  showArchived: boolean;
  onChange: (next: boolean) => void;
  /** Optional count of archived rows to surface as a small badge. */
  archivedCount?: number;
};

// Phase 10a "Show archived" toggle — used in list-view toolbars across surfaces
// (Assets, Creative Library, Users, Shares). Stateless; parent owns the flag
// and uses it to switch the fetch URL between `?includeArchived=1` and the
// default (live-only) view.
export default function ArchiveToggle({
  showArchived,
  onChange,
  archivedCount,
}: Props) {
  return (
    <button
      type="button"
      onClick={() => onChange(!showArchived)}
      className={clsx(
        "archive-toggle toolbar-btn flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition",
        showArchived
          ? "archive-toggle--on border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "archive-toggle--off border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
      )}
      title={showArchived ? "Hide archived" : "Show archived"}
    >
      {showArchived ? (
        <ArchiveRestore className="size-3.5" />
      ) : (
        <Archive className="size-3.5" />
      )}
      {showArchived ? "Hide archived" : "Show archived"}
      {!showArchived && archivedCount && archivedCount > 0 ? (
        <span className="archive-toggle__count rounded bg-slate-200 px-1 text-[10px] text-slate-700">
          {archivedCount}
        </span>
      ) : null}
    </button>
  );
}
