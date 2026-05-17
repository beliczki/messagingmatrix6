"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import clsx from "clsx";
import type { Codec } from "./usePersistent";

export const LIST_GRID_TEMPLATE = "48px 80px minmax(0,1fr) 120px 80px 100px 88px 88px";

export type ListSortKey =
  | "mc"
  | "name"
  | "product"
  | "type"
  | "size"
  | "createdAt"
  | "updatedAt";

export type SortState = { key: ListSortKey; dir: "asc" | "desc" };

const HEADER_COLS: ReadonlyArray<{ key: ListSortKey; label: string }> = [
  { key: "mc", label: "MC" },
  { key: "name", label: "Name" },
  { key: "product", label: "Product" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
  { key: "createdAt", label: "Created" },
  { key: "updatedAt", label: "Updated" },
];

const VALID_KEYS: ReadonlyArray<ListSortKey> = HEADER_COLS.map((c) => c.key);

export const DEFAULT_SORT: SortState = { key: "createdAt", dir: "desc" };

export const LIST_SORT_CODEC: Codec<SortState> = {
  parse: (s) => {
    try {
      const v = JSON.parse(s) as Partial<SortState>;
      if (
        v &&
        typeof v.key === "string" &&
        (VALID_KEYS as ReadonlyArray<string>).includes(v.key) &&
        (v.dir === "asc" || v.dir === "desc")
      ) {
        return { key: v.key as ListSortKey, dir: v.dir };
      }
    } catch {}
    return DEFAULT_SORT;
  },
  stringify: (v) => JSON.stringify(v),
};

export function toggleSort(prev: SortState, key: ListSortKey): SortState {
  if (prev.key === key) {
    return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: "asc" };
}

export function ListSortHeader({
  sort,
  onChange,
}: {
  sort: SortState;
  onChange: (next: SortState) => void;
}) {
  return (
    <div
      className="list-sort-header sticky top-0 z-[5] grid h-8 items-center border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600"
      style={{ gridTemplateColumns: LIST_GRID_TEMPLATE }}
    >
      <div aria-hidden className="border-r border-slate-200" />
      {HEADER_COLS.map((c, i) => {
        const active = sort.key === c.key;
        const isLast = i === HEADER_COLS.length - 1;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(toggleSort(sort, c.key))}
            title={`Sort by ${c.label}`}
            className={clsx(
              "list-sort-header__cell flex h-full min-w-0 items-center gap-1 px-3 text-left hover:bg-slate-100",
              !isLast && "border-r border-slate-200",
              active && "list-sort-header__cell--active text-slate-900",
            )}
          >
            <span className="truncate">{c.label}</span>
            {active ? (
              sort.dir === "asc" ? (
                <ArrowUp className="size-3 shrink-0" />
              ) : (
                <ArrowDown className="size-3 shrink-0" />
              )
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Sort helpers ─────────────────────────────────────────────────────────

type Sortable = {
  id: number;
  fileName: string | null;
  product: string | null;
  type: string | null;
  fileDimensions: string | null;
  mcNumber?: number | null;
  mcVariant?: string | null;
  createdAt: string;
  updatedAt: string;
};

function parseArea(dims: string | null): number {
  if (!dims) return -1;
  const m = dims.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return -1;
  return parseInt(m[1]!, 10) * parseInt(m[2]!, 10);
}

function isMissing(row: Sortable, key: ListSortKey): boolean {
  switch (key) {
    case "mc":
      return row.mcNumber == null;
    case "name":
      return !row.fileName;
    case "product":
      return !row.product;
    case "type":
      return !row.type;
    case "size":
      return parseArea(row.fileDimensions) < 0;
    case "createdAt":
      return !row.createdAt || Number.isNaN(Date.parse(row.createdAt));
    case "updatedAt":
      return !row.updatedAt || Number.isNaN(Date.parse(row.updatedAt));
  }
}

function compareValues(a: Sortable, b: Sortable, key: ListSortKey): number {
  switch (key) {
    case "mc": {
      const an = a.mcNumber ?? 0;
      const bn = b.mcNumber ?? 0;
      if (an !== bn) return an - bn;
      const av = a.mcVariant ?? "";
      const bv = b.mcVariant ?? "";
      return av.localeCompare(bv);
    }
    case "name": {
      const av = a.fileName ?? "";
      const bv = b.fileName ?? "";
      return av.localeCompare(bv, undefined, { numeric: true });
    }
    case "product":
    case "type": {
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      return av.localeCompare(bv);
    }
    case "size":
      return parseArea(a.fileDimensions) - parseArea(b.fileDimensions);
    case "createdAt":
    case "updatedAt":
      return Date.parse(a[key]) - Date.parse(b[key]);
  }
}

// Sorts a copy of `rows` by the given sort. Missing values sink to the bottom
// regardless of direction; ties break on id desc for stable order.
export function sortListRows<T extends Sortable>(
  rows: ReadonlyArray<T>,
  sort: SortState,
): T[] {
  const out = rows.slice();
  out.sort((a, b) => {
    const aMissing = isMissing(a, sort.key);
    const bMissing = isMissing(b, sort.key);
    if (aMissing && !bMissing) return 1;
    if (!aMissing && bMissing) return -1;
    const cmp = compareValues(a, b, sort.key);
    if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
    return b.id - a.id;
  });
  return out;
}

// ── Date formatting (compact for the Created / Updated columns) ──────────

export function formatListDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "today";
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays > 0 && diffDays < 7) return `${diffDays}d ago`;
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}
