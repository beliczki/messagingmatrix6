"use client";

import { X, Filter as FilterIcon, Users, ListTree } from "lucide-react";
import { type Filters } from "./types";
import MultiPill from "../_components/MultiPill";

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  productOptions: string[];
  statusOptions: string[];
  counts: {
    audiences: number;
    topics: number;
    messages: number;
    visible: number;
    visibleAudiences: number;
    visibleTopics: number;
  };
};

export default function MatrixToolbar(p: Props) {
  const activeFilters =
    p.filters.products.size + p.filters.statuses.size + (p.filters.search ? 1 : 0);

  return (
    <div className="toolbar matrix-toolbar sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="matrix-toolbar__brand flex items-baseline gap-2">
        <div className="matrix-toolbar__title text-sm font-semibold text-slate-900">Matrix</div>
      </div>

      <div className="input-box input-box--with-icon relative ml-2">
        <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filter… a: t: s: p: mc: OR …"
          title='Free text searches all fields. Prefixes: a: (audience), t: (topic), s: (strategy), p: (platform), mc: (MC#). a:/t:/s:/p: also hide non-matching rows/columns. AND implicit, OR explicit. Quote "two words" for phrases.'
          value={p.filters.search}
          onChange={(e) =>
            p.setFilters({ ...p.filters, search: e.target.value })
          }
          className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

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
          className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      <div
        className="matrix-toolbar__count ml-auto flex items-center gap-2 text-[11px] tabular-nums text-slate-500"
        title={`${p.counts.visible}/${p.counts.messages} messages · ${p.counts.visibleAudiences}/${p.counts.audiences} audiences · ${p.counts.visibleTopics}/${p.counts.topics} topics`}
      >
        <span className="matrix-toolbar__count-item">
          mc: {p.counts.visible}/{p.counts.messages}
        </span>
        <span className="matrix-toolbar__count-item inline-flex items-center gap-1" title="Audiences">
          <Users className="size-3" aria-label="Audiences" />
          {p.counts.visibleAudiences}/{p.counts.audiences}
        </span>
        <span className="matrix-toolbar__count-item inline-flex items-center gap-1" title="Topics">
          <ListTree className="size-3" aria-label="Topics" />
          {p.counts.visibleTopics}/{p.counts.topics}
        </span>
      </div>
    </div>
  );
}
