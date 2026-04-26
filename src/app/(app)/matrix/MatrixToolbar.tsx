"use client";

import { X } from "lucide-react";
import { type Filters } from "./types";
import MultiPill from "../_components/MultiPill";

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  productOptions: string[];
  statusOptions: string[];
  counts: { audiences: number; topics: number; messages: number; visible: number };
};

export default function MatrixToolbar(p: Props) {
  const activeFilters =
    p.filters.products.size + p.filters.statuses.size + (p.filters.search ? 1 : 0);

  return (
    <div className="sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-semibold text-slate-900">Matrix</div>
        <div className="text-xs text-slate-500">
          {p.counts.visible}/{p.counts.messages} messages · {p.counts.audiences}{" "}
          audiences · {p.counts.topics} topics
        </div>
      </div>

      <input
        type="search"
        placeholder="Search MC, name, headline…"
        value={p.filters.search}
        onChange={(e) =>
          p.setFilters({ ...p.filters, search: e.target.value })
        }
        className="ml-2 w-56 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      />

      <MultiPill
        label="Product"
        values={p.filters.products}
        options={p.productOptions}
        onChange={(s) => p.setFilters({ ...p.filters, products: s })}
      />
      <MultiPill
        label="Status"
        values={p.filters.statuses}
        options={p.statusOptions}
        onChange={(s) => p.setFilters({ ...p.filters, statuses: s })}
      />

      {activeFilters > 0 ? (
        <button
          onClick={() =>
            p.setFilters({
              products: new Set(),
              statuses: new Set(),
              search: "",
            })
          }
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
