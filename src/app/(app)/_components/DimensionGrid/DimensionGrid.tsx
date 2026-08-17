"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ArrowDown,
  Loader2,
  Check,
  CircleAlert,
  AlertTriangle,
  History,
  Lock,
} from "lucide-react";
import clsx from "clsx";
import { type Column } from "./columns";
import { useRowAutosave, type Versioned, type RowSaveState } from "./useRowAutosave";
import DimensionEditPanel from "./DimensionEditPanel";
import ArchiveToggle from "../ArchiveToggle";
import MultiPill, { STATUS_QUICK_SELECT } from "../MultiPill";
import RightToolbar from "../RightToolbar";
import EntityHistoryDrawer, {
  type HistoryEntity,
} from "../EntityHistoryDrawer";
import {
  usePersistent,
  STRING_CODEC,
  SET_CODEC,
  type Codec,
} from "../usePersistent";
import { parseSearchQuery, type SearchFields } from "@/lib/search-query";

// Settings → Keywords lookup: form → field → allowed values, in display order.
// Empty object (default) ⇒ no autocomplete suggestions; the cell still accepts
// freeform input — matches the "freeform-allowed" decision.
export type KeywordOptions = Record<string, Record<string, string[]>>;

type Props<T extends Versioned> = {
  title: string;
  rows: T[];
  columns: Column<T>[];
  baseUrl: string;
  queryKey: readonly unknown[];
  toSearchFields: (row: T) => SearchFields;
  productOptions: string[];
  statusOptions: string[];
  /** Optional: Settings → Keywords seeded suggestions for `autocomplete` cells. */
  keywordOptions?: KeywordOptions;
  getProduct: (row: T) => string | null;
  getStatus: (row: T) => string | null;
  showArchived: boolean;
  onShowArchivedChange: (next: boolean) => void;
  archivedCount: number;
  isArchived: (row: T) => boolean;
  /** Persisted column-visibility key, e.g. "mm6_audiences_grid_cols". */
  visibilityStorageKey: string;
  /** Persisted RightToolbar open/closed key. */
  rightToolbarStorageKey: string;
  /** Prefix used to derive per-filter localStorage keys (search, products, statuses, sort). */
  storageKeyPrefix: string;
  /** When set, a single-row selection shows a "History" action in the right
   *  toolbar opening the audit-log revision drawer. Omit for grids whose
   *  entity has no history endpoint (e.g. texts). */
  historyEntity?: HistoryEntity;
  /** Human label for the history drawer header — falls back to `#<id>`. */
  getHistoryLabel?: (row: T) => string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

const SORT_CODEC: Codec<SortState> = {
  parse: (s) => {
    try {
      const v = JSON.parse(s);
      if (v === null) return null;
      if (
        v &&
        typeof v.key === "string" &&
        (v.dir === "asc" || v.dir === "desc")
      ) {
        return { key: v.key, dir: v.dir };
      }
      return null;
    } catch {
      return null;
    }
  },
  stringify: (v) => JSON.stringify(v),
};

const ROW_HEIGHT = 32;

export default function DimensionGrid<T extends Versioned>({
  title,
  rows,
  columns,
  baseUrl,
  queryKey,
  toSearchFields,
  productOptions,
  statusOptions,
  keywordOptions,
  getProduct,
  getStatus,
  showArchived,
  onShowArchivedChange,
  archivedCount,
  isArchived,
  visibilityStorageKey,
  rightToolbarStorageKey,
  storageKeyPrefix,
  historyEntity,
  getHistoryLabel,
}: Props<T>) {
  const kwOpts: KeywordOptions = keywordOptions ?? {};
  const [search, setSearch] = usePersistent(
    `${storageKeyPrefix}_filter_search`,
    "",
    STRING_CODEC,
  );
  const [products, setProducts] = usePersistent<Set<string>>(
    `${storageKeyPrefix}_filter_products`,
    new Set(),
    SET_CODEC,
  );
  const [statuses, setStatuses] = usePersistent<Set<string>>(
    `${storageKeyPrefix}_filter_statuses`,
    new Set(),
    SET_CODEC,
  );
  const [sort, setSort] = usePersistent<SortState>(
    `${storageKeyPrefix}_sort`,
    { key: "orderIndex", dir: "asc" },
    SORT_CODEC,
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null);
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number; key: string } | null>(null);

  const [hidden, setHidden] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(visibilityStorageKey);
      if (!raw) {
        return new Set(
          columns.filter((c) => c.defaultVisible === false).map((c) => c.key),
        );
      }
      return new Set(JSON.parse(raw) as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(visibilityStorageKey, JSON.stringify([...hidden]));
  }, [hidden, visibilityStorageKey]);

  const { statesById, save } = useRowAutosave<T>({ baseUrl, queryKey });

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hidden.has(c.key)),
    [columns, hidden],
  );

  const filtered = useMemo(() => {
    const predicate = parseSearchQuery(search);
    let out = rows.filter((r) => {
      if (products.size > 0) {
        const p = getProduct(r);
        if (!p || !products.has(p)) return false;
      }
      if (statuses.size > 0) {
        const s = getStatus(r);
        if (!s || !statuses.has(s)) return false;
      }
      return predicate(toSearchFields(r));
    });
    if (sort) {
      const k = sort.key as keyof T;
      out = out.slice().sort((a, b) => {
        const av = a[k];
        const bv = b[k];
        const cmp = compare(av, bv);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, search, products, statuses, sort, getProduct, getStatus, toSearchFields]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((r) => selected.has(r.id));

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );

  const historyRow =
    historyOpenId !== null
      ? rows.find((r) => r.id === historyOpenId)
      : undefined;

  const totalWidth =
    40 + visibleColumns.reduce((sum, c) => sum + c.width, 0) + 28;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  function toggleSort(key: string) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function toggleSelectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  function handleRowCheckbox(
    e: React.MouseEvent<HTMLInputElement>,
    rowId: number,
  ) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedId !== null) {
        const startIdx = filteredIds.indexOf(lastClickedId);
        const endIdx = filteredIds.indexOf(rowId);
        if (startIdx >= 0 && endIdx >= 0) {
          const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const shouldAdd = !prev.has(rowId);
          for (let i = lo; i <= hi; i++) {
            const id = filteredIds[i]!;
            if (shouldAdd) next.add(id);
            else next.delete(id);
          }
          return next;
        }
      }
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
    setLastClickedId(rowId);
  }

  function handleCellCommit(row: T, col: Column<T>, raw: string) {
    setEditing(null);
    const current = row[col.key];
    let next: unknown;
    if (col.type.kind === "number") {
      const n = Number(raw);
      next = Number.isFinite(n) ? n : current;
    } else {
      next = raw === "" ? null : raw;
    }
    if ((current ?? null) === (next ?? null)) return;
    void save(row, { [col.key]: next } as Partial<T>);
  }

  return (
    <div className="dimension-page flex h-full">
      <div className="dimension-grid flex flex-1 flex-col overflow-hidden">
      <div className="dimension-grid__toolbar toolbar sticky top-0 z-40 flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="dimension-grid__brand flex items-baseline gap-2">
          <div className="dimension-grid__title toolbar__title text-sm font-semibold text-slate-900">
            {title}
          </div>
        </div>

        <div className="input-box input-box--with-icon relative ml-2">
          <input
            type="search"
            placeholder="Filter… s: p: text"
            title='Free text searches all visible fields. Prefixes: s: (strategy), p: (platform). AND implicit, OR explicit. Quote "two words" for phrases.'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-box__field w-72 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
          />
        </div>
        <MultiPill
          label="Product"
          values={products}
          options={productOptions}
          onChange={setProducts}
        />
        <MultiPill
          label="Status"
          values={statuses}
          options={statusOptions}
          quickSelect={STATUS_QUICK_SELECT}
          onChange={setStatuses}
        />
        <MultiPill
          label="Columns"
          values={
            new Set(columns.filter((c) => !hidden.has(c.key)).map((c) => c.key))
          }
          options={columns.map((c) => c.key)}
          onChange={(visibleSet) => {
            const next = new Set<string>();
            for (const c of columns) {
              if (!visibleSet.has(c.key)) next.add(c.key);
            }
            setHidden(next);
          }}
        />
        <div className="dimension-grid__count ml-auto text-[11px] tabular-nums text-slate-500">
          {filtered.length}/{rows.length}
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </div>
      </div>

      <div ref={scrollRef} className="dimension-grid__scroll relative flex-1 overflow-auto">
        <div style={{ width: totalWidth, position: "relative" }}>
          {/* Header */}
          <div
            className="dimension-grid__header sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600"
            style={{ width: totalWidth }}
          >
            <div
              className="dimension-grid__cell--checkbox flex h-8 shrink-0 items-center justify-center border-r border-slate-200"
              style={{ width: 40 }}
            >
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someFilteredSelected;
                }}
                onChange={toggleSelectAllFiltered}
                aria-label="Select all (filtered)"
              />
            </div>
            {visibleColumns.map((c) => {
              const sortIcon =
                sort?.key === c.key
                  ? sort.dir === "asc"
                    ? <ArrowUp className="size-3" />
                    : <ArrowDown className="size-3" />
                  : null;
              return (
                <button
                  type="button"
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className="dimension-grid__cell--header flex h-8 shrink-0 items-center gap-1 border-r border-slate-200 px-2 hover:bg-slate-100"
                  style={{ width: c.width }}
                  title={`Sort by ${c.label}`}
                >
                  <span className="truncate">{c.label}</span>
                  {sortIcon}
                </button>
              );
            })}
            <div className="dimension-grid__cell--state shrink-0" style={{ width: 28 }} />
          </div>

          {/* Body */}
          <div
            className="dimension-grid__body relative"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const row = filtered[vr.index];
              if (!row) return null;
              const isSelected = selected.has(row.id);
              const archived = isArchived(row);
              const state = statesById[row.id];
              return (
                <div
                  key={row.id}
                  className={clsx(
                    "dimension-grid__row absolute left-0 flex border-b border-slate-100",
                    isSelected && "dimension-grid__row--selected bg-blue-50",
                    !isSelected && "hover:bg-slate-50",
                    archived && "dimension-grid__row--archived opacity-60",
                  )}
                  style={{
                    top: vr.start,
                    height: ROW_HEIGHT,
                    width: totalWidth,
                  }}
                >
                  <div
                    className="dimension-grid__cell--checkbox flex shrink-0 items-center justify-center border-r border-slate-100"
                    style={{ width: 40 }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onClick={(e) => handleRowCheckbox(e, row.id)}
                      onChange={() => {
                        /* handled in onClick */
                      }}
                    />
                  </div>
                  {visibleColumns.map((c) => (
                    <Cell
                      key={c.key}
                      row={row}
                      col={c}
                      isEditing={
                        editing?.id === row.id && editing.key === c.key
                      }
                      onEdit={() => {
                        if (c.type.kind === "text" && c.type.readOnly) return;
                        setEditing({ id: row.id, key: c.key });
                      }}
                      onCommit={(raw) => handleCellCommit(row, c, raw)}
                      onCancel={() => setEditing(null)}
                      productOptions={productOptions}
                      keywordOptions={kwOpts}
                    />
                  ))}
                  <div
                    className="dimension-grid__cell--state flex shrink-0 items-center justify-center"
                    style={{ width: 28 }}
                    title={stateTitle(state)}
                  >
                    <SaveDot state={state} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      </div>

      <RightToolbar storageKey={rightToolbarStorageKey}>
        {(collapsed) => (
          <div
            className={clsx(
              "dimension-grid__right-toolbar-content",
              collapsed ? "flex flex-col items-center gap-2" : "flex flex-col gap-3",
            )}
          >
            <DimensionEditPanel
              selected={selectedRows}
              columns={columns}
              productOptions={productOptions}
              baseUrl={baseUrl}
              queryKey={queryKey}
              onClearSelection={() => setSelected(new Set())}
              collapsed={collapsed}
            />
            {historyEntity && selectedRows.length === 1 ? (
              <button
                type="button"
                onClick={() => setHistoryOpenId(selectedRows[0]!.id)}
                title="View revision history"
                className={clsx(
                  "dimension-grid__history-btn toolbar-btn flex items-center gap-1.5 rounded border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50",
                  collapsed ? "size-8 justify-center p-0" : "px-2.5 py-1.5",
                )}
              >
                <History className="size-3.5" />
                {!collapsed ? "History" : null}
              </button>
            ) : null}
            <ArchiveToggle
              showArchived={showArchived}
              onChange={onShowArchivedChange}
              archivedCount={archivedCount}
              collapsed={collapsed}
            />
            {!collapsed && selected.size === 0 ? (
              <div className="dimension-grid__right-toolbar-hint text-[11px] text-slate-500">
                {filtered.length} of {rows.length}
              </div>
            ) : null}
          </div>
        )}
      </RightToolbar>

      {historyOpenId !== null && historyEntity ? (
        <EntityHistoryDrawer
          entity={historyEntity}
          entityId={historyOpenId}
          label={
            historyRow && getHistoryLabel
              ? getHistoryLabel(historyRow)
              : `#${historyOpenId}`
          }
          onClose={() => setHistoryOpenId(null)}
        />
      ) : null}
    </div>
  );
}

function Cell<T extends Versioned>({
  row,
  col,
  isEditing,
  onEdit,
  onCommit,
  onCancel,
  productOptions,
  keywordOptions,
}: {
  row: T;
  col: Column<T>;
  isEditing: boolean;
  onEdit: () => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
  productOptions: string[];
  keywordOptions: KeywordOptions;
}) {
  const raw = row[col.key];
  const display =
    raw === null || raw === undefined || raw === "" ? "" : String(raw);
  const readOnly = col.type.kind === "text" && col.type.readOnly;

  if (isEditing) {
    return (
      <div
        className="dimension-grid__cell dimension-grid__cell--editing shrink-0 border-r border-slate-100 p-0"
        style={{ width: col.width }}
      >
        <CellEditor
          col={col}
          initial={display}
          onCommit={onCommit}
          onCancel={onCancel}
          productOptions={productOptions}
          keywordOptions={keywordOptions}
        />
      </div>
    );
  }

  const isKeyCol = col.key === "key";
  const mcCount = row.mcCount ?? 0;
  const keyFrozen = isKeyCol && mcCount > 0;
  const cellTitle = keyFrozen
    ? `Auto-key frozen — ${mcCount} ${mcCount === 1 ? "MC references" : "MCs reference"} this`
    : display;

  return (
    <div
      onClick={onEdit}
      className={clsx(
        "dimension-grid__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs",
        readOnly
          ? "dimension-grid__cell--readonly cursor-default text-slate-500"
          : "cursor-text text-slate-900 hover:bg-white",
        isKeyCol && "font-mono text-[11px]",
        keyFrozen && "dimension-grid__cell--frozen gap-1",
      )}
      style={{ width: col.width }}
      title={cellTitle}
    >
      {keyFrozen ? (
        <Lock className="dimension-grid__cell-lock size-3 shrink-0 text-slate-400" />
      ) : null}
      <span className="truncate">{display}</span>
    </div>
  );
}

function CellEditor<T extends Versioned>({
  col,
  initial,
  onCommit,
  onCancel,
  productOptions,
  keywordOptions,
}: {
  col: Column<T>;
  initial: string;
  onCommit: (raw: string) => void;
  onCancel: () => void;
  productOptions: string[];
  keywordOptions: KeywordOptions;
}) {
  const [value, setValue] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) {
      ref.current.select();
    }
  }, []);

  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  if (col.type.kind === "select") {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={onKey}
        className="dimension-grid__editor h-full w-full border-0 bg-white px-2 text-xs focus:outline-none"
      >
        {col.type.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "" ? "— none —" : opt}
          </option>
        ))}
      </select>
    );
  }
  if (col.type.kind === "select-dynamic") {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={onKey}
        className="dimension-grid__editor h-full w-full border-0 bg-white px-2 text-xs focus:outline-none"
      >
        <option value="">— none —</option>
        {productOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (col.type.kind === "autocomplete") {
    // Open with empty input + current value as placeholder so the native
    // <datalist> shows the full options list — Chrome filters suggestions by
    // the input's current value, so pre-filling with the cell value would
    // collapse the list to just the current match. Blur/Enter without typing
    // commits the original (no-op via handleCellCommit's equality guard).
    const opts =
      keywordOptions[col.type.source.form]?.[col.type.source.field] ?? [];
    const listId = `kw-${col.type.source.form}-${col.type.source.field}`;
    const commitValue = dirty ? value : initial;
    return (
      <>
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          type="text"
          list={listId}
          value={dirty ? value : ""}
          placeholder={initial}
          onChange={(e) => {
            setValue(e.target.value);
            setDirty(true);
          }}
          onBlur={() => onCommit(commitValue)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(commitValue);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="autocomplete-field h-full w-full border-0 bg-white px-2 text-xs focus:outline-none"
        />
        <datalist id={listId}>
          {opts.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </>
    );
  }
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type={col.type.kind === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={onKey}
      className="dimension-grid__editor h-full w-full border-0 bg-white px-2 text-xs focus:outline-none"
    />
  );
}

function SaveDot({ state }: { state: RowSaveState | undefined }) {
  if (!state || state.kind === "idle") return null;
  if (state.kind === "saving") return <Loader2 className="size-3 animate-spin text-slate-500" />;
  if (state.kind === "saved") return <Check className="size-3 text-emerald-600" />;
  if (state.kind === "conflict") return <AlertTriangle className="size-3 text-amber-600" />;
  return <CircleAlert className="size-3 text-rose-600" />;
}

function stateTitle(state: RowSaveState | undefined): string {
  if (!state || state.kind === "idle") return "";
  if (state.kind === "saving") return "Saving…";
  if (state.kind === "saved") return "Saved";
  if (state.kind === "conflict") return "Refreshed (someone else edited this)";
  return `Save failed: ${state.message}`;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
