"use client";

import { X, Filter as FilterIcon, Users, ListTree } from "lucide-react";
import { type Filters, type MatrixAxis, STATUS_COLOR } from "./types";
import MultiPill, { ALL_NONE_QUICK_SELECT } from "../_components/MultiPill";

const AXES: Array<{ key: MatrixAxis; label: string }> = [
  { key: "dco", label: "DCO" },
  // The stored token stays "nondco": it is persisted in the matrix state
  // (mm6_matrix_state_v1) and an unknown value falls back to "dco", so renaming
  // it would silently reset every saved view. Only the vocabulary is Agentic.
  { key: "nondco", label: "Agentic" },
];

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  productOptions: string[];
  statusOptions: string[];
  // MC count per status in the current result set (status filter excluded).
  statusCounts: Record<string, number>;
  // MC inventory per product — whole set, not the result. Segments that are
  // zero for every product are dropped, so the labels come with them.
  productCounts: Record<string, number[]>;
  productCountLabels: string[];
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

      <div
        className="matrix-axis-toggle ml-2 inline-flex overflow-hidden rounded-md border border-slate-300 text-xs font-medium"
        role="group"
        aria-label="DCO / Agentic view"
      >
        {AXES.map((ax) => (
          <button
            key={ax.key}
            type="button"
            aria-pressed={p.filters.axis === ax.key}
            onClick={() => p.setFilters({ ...p.filters, axis: ax.key })}
            className={`matrix-axis-toggle__btn px-2.5 py-1 ${
              p.filters.axis === ax.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
          >
            {ax.label}
          </button>
        ))}
      </div>

      <div className="input-box input-box--with-icon relative ml-2">
        <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filter… a: t: s: p: mc: OR …"
          title='Free text searches all fields. Prefixes: a: (audience), t: (topic), s: (strategy), p: (platform), mc: (MC#). a:/p:/s: hide non-matching audience columns; t: hides non-matching topic rows; mc: hides both. Free text keeps the full grid. AND implicit, OR explicit. Quote "two words" for phrases.'
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
        optionCounts={p.productCounts}
        countLabels={p.productCountLabels}
        quickSelect={ALL_NONE_QUICK_SELECT}
        onChange={(s) => p.setFilters({ ...p.filters, products: s })}
      />
      <MultiPill
        label="Status"
        values={p.filters.statuses}
        options={p.statusOptions}
        optionColors={STATUS_COLOR}
        optionCounts={p.statusCounts}
        quickSelect={ALL_NONE_QUICK_SELECT}
        onChange={(s) => p.setFilters({ ...p.filters, statuses: s })}
      />

      {activeFilters > 0 ? (
        <button
          onClick={() =>
            p.setFilters({
              ...p.filters,
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
