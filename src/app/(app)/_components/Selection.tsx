"use client";

// Select mode for a library page (Creative Library, Assets): the state, the
// tile wrapper and the toolbar block, so both pages select and share the same
// way. Select mode starts from the toolbar's Select button or a long-press on a
// tile, and lasts until Cancel / Esc / a finished share — not until the last
// tile is unticked, or entering through the button would end at once.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";
import { useLongPress } from "@/app/_components/useLongPress";

export function useSelection() {
  const [selectorMode, setSelectorMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const enter = useCallback(() => setSelectorMode(true), []);

  const clear = useCallback(() => {
    setSelectorMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Adds the whole filtered set, not just the rows the scroller has
  // materialised — the toolbar count and the share dialog both work off ids.
  // It adds rather than replaces: a selection is often built across filters.
  const selectAll = useCallback((ids: number[]) => {
    setSelectorMode(true);
    setSelectedIds((prev) => new Set([...prev, ...ids]));
  }, []);

  const begin = useCallback((id: number) => {
    setSelectorMode(true);
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Esc clears selection (only when not editing in an input).
  useEffect(() => {
    if (!selectorMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      clear();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectorMode, clear]);

  return { selectorMode, selectedIds, enter, clear, toggle, selectAll, begin };
}

export function SelectableItem({
  id,
  selectorMode,
  selected,
  onLongPress,
  onSelect,
  children,
}: {
  id: number;
  selectorMode: boolean;
  selected: boolean;
  onLongPress: (id: number) => void;
  onSelect: (id: number) => void;
  children: ReactNode;
}) {
  const longPress = useLongPress(() => onLongPress(id));
  return (
    <div
      className={clsx(
        // `isolate` keeps the ring and the checkbox below inside this tile's own
        // stacking context. Without it their z-20 competes with the whole page,
        // so a selected tile painted over the sticky toolbar (z-10) and through
        // any filter dropdown open above it.
        "selectable-item relative isolate",
        selected && "selectable-item--selected",
      )}
      onPointerDown={longPress.onPointerDown}
      onPointerUp={longPress.onPointerUp}
      onPointerLeave={longPress.onPointerLeave}
      onPointerMove={longPress.onPointerMove}
      onClickCapture={(e) => {
        if (longPress.consumeNextClick()) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (selectorMode) {
          e.stopPropagation();
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      {children}
      {selectorMode ? (
        <span
          aria-hidden
          className={clsx(
            "selector-checkbox pointer-events-none absolute right-2 top-2 z-20 flex size-5 items-center justify-center rounded-full border shadow-sm",
            selected
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-400 bg-white/80 text-transparent",
          )}
        >
          <Icon name="check" className="size-3" bold />
        </span>
      ) : null}
      {selected ? (
        <span
          aria-hidden
          className="selectable-item__ring pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-slate-900"
        />
      ) : null}
    </div>
  );
}

/**
 * The toolbar's selection block. Outside select mode it is the Select button;
 * in it, the count and the actions. `noun` names what the page selects
 * ("creative", "asset") in the Select-all tooltip.
 */
export function SelectionActions({
  collapsed,
  selectorMode,
  count,
  filteredCount,
  unselectedFilteredCount,
  noun,
  onEnter,
  onSelectAll,
  onShare,
  onAddToShared,
  onCancel,
}: {
  collapsed: boolean;
  selectorMode: boolean;
  count: number;
  filteredCount: number;
  /** Filtered items not yet in the selection — what the button would add. */
  unselectedFilteredCount: number;
  noun: string;
  onEnter: () => void;
  onSelectAll: () => void;
  onShare: () => void;
  onAddToShared: () => void;
  onCancel: () => void;
}) {
  if (!selectorMode) {
    return (
      <button
        type="button"
        onClick={onEnter}
        title={`Select ${noun}s to share`}
        aria-label="Select"
        className={clsx(
          "toolbar-btn selection-actions__btn--select inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
          collapsed ? "size-9" : "px-3 py-1.5 text-xs font-medium",
        )}
      >
        <Icon name="check" className={collapsed ? "size-4" : "size-3.5"} />
        {!collapsed ? "Select" : null}
      </button>
    );
  }
  // Nothing left to add once the whole filtered set is in — the button stays
  // put (so the toolbar does not reflow) but says so. Judged by membership, not
  // by comparing counts: a selection carried over from an earlier filter can
  // outnumber the current one while most of it is still unselected.
  const allSelected = unselectedFilteredCount === 0;
  const selectAllLabel = allSelected
    ? `All ${filteredCount} filtered selected`
    : `Add all filtered (${unselectedFilteredCount}) to selection`;
  const nothing = count === 0;
  if (collapsed) {
    return (
      <div className="selection-actions selection-actions--collapsed flex flex-col items-center gap-2 border-b border-slate-200 pb-2">
        <span
          className="selection-actions__count flex size-9 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white"
          title={`${count} selected`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={allSelected}
          title={selectAllLabel}
          aria-label={selectAllLabel}
          className="toolbar-btn flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="check-double" className="size-4" />
        </button>
        <button
          type="button"
          onClick={onShare}
          disabled={nothing}
          title="Share selected"
          aria-label="Share selected"
          className="toolbar-btn--primary flex size-9 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="share" className="size-4" />
        </button>
        <button
          type="button"
          onClick={onAddToShared}
          disabled={nothing}
          title="Add selected to an existing share"
          aria-label="Add selected to an existing share"
          className="toolbar-btn selection-actions__btn--add-to-shared flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="copy-add" className="size-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel selection"
          aria-label="Cancel selection"
          className="toolbar-btn flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <Icon name="close" className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="selection-actions flex flex-col gap-2 border-b border-slate-200 pb-3">
      <div className="selection-actions__count text-xs font-semibold text-slate-700">
        {nothing ? "Click items to select" : `${count} selected`}
      </div>
      <button
        type="button"
        onClick={onSelectAll}
        disabled={allSelected}
        title={`Add every ${noun} the current filters match (${filteredCount}) to the selection`}
        className="toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="check-double" className="size-3.5" />
        {selectAllLabel}
      </button>
      <button
        type="button"
        onClick={onShare}
        disabled={nothing}
        className="toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="share" className="size-3.5" />
        Share
      </button>
      <button
        type="button"
        onClick={onAddToShared}
        disabled={nothing}
        title="Add the selection to an existing share"
        className="toolbar-btn selection-actions__btn--add-to-shared inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="copy-add" className="size-3.5" />
        Add to shared
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <Icon name="close" className="size-3" />
        Cancel
      </button>
    </div>
  );
}
