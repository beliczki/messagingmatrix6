"use client";

import { Layers, Rows3, Table2, ListFilter, X } from "lucide-react";
import clsx from "clsx";
import { type Density, type Filters, type View } from "./types";

type Props = {
  view: View;
  setView: (v: View) => void;
  density: Density;
  setDensity: (d: Density) => void;
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
    <div className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
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

      <div className="ml-auto flex items-center gap-1">
        <ToggleGroup>
          <ToggleButton active={p.view === "grid"} onClick={() => p.setView("grid")}>
            <Table2 className="size-3.5" />
            Grid
          </ToggleButton>
          <ToggleButton active={p.view === "feed"} onClick={() => p.setView("feed")}>
            <ListFilter className="size-3.5" />
            Feed
          </ToggleButton>
        </ToggleGroup>

        {p.view === "grid" ? (
          <ToggleGroup>
            <ToggleButton
              active={p.density === "informative"}
              onClick={() => p.setDensity("informative")}
            >
              <Layers className="size-3.5" />
              Informative
            </ToggleButton>
            <ToggleButton
              active={p.density === "minimal"}
              onClick={() => p.setDensity("minimal")}
            >
              <Rows3 className="size-3.5" />
              Minimal
            </ToggleButton>
          </ToggleGroup>
        ) : null}
      </div>
    </div>
  );
}

function ToggleGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 rounded px-2 py-1",
        active
          ? "bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

function MultiPill({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: Set<string>;
  options: string[];
  onChange: (s: Set<string>) => void;
}) {
  if (options.length === 0) return null;
  return (
    <details className="relative text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50">
        <span>{label}</span>
        {values.size > 0 ? (
          <span className="rounded-full bg-slate-900 px-1.5 text-[10px] font-medium text-white">
            {values.size}
          </span>
        ) : null}
      </summary>
      <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
        {options.map((opt) => {
          const checked = values.has(opt);
          return (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-100"
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
              <span className="truncate">{opt}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
