"use client";

import { Download } from "lucide-react";
import type { Filters } from "./types";

// Matrix XLSX export: per-product matrix tabs + Audiences/Topics/MCs sheets,
// scoped by the page's current product + status filters (search is not part
// of the export scope — the chips show exactly what goes in).
export default function MatrixExportPanel({ filters }: { filters: Filters }) {
  const products = [...filters.products];
  const statuses = [...filters.statuses];

  function download() {
    const params = new URLSearchParams();
    if (products.length) params.set("products", products.join(","));
    if (statuses.length) params.set("statuses", statuses.join(","));
    const qs = params.toString();
    window.location.href = `/api/export/matrix-xlsx${qs ? `?${qs}` : ""}`;
  }

  // The box and the "Export" title belong to ExportPanel, which owns the
  // Matrix/Feed switch; this renders only the matrix branch's own setup.
  return (
    <div className="matrix-export-panel">
      <div className="matrix-export-panel__filters flex flex-wrap items-center gap-1.5">
        {(products.length ? products : ["All products"]).map((label) => (
          <span
            key={`p-${label}`}
            className="filter-chip inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700"
            title="Filter: product"
          >
            {label}
          </span>
        ))}
        <span
          className="filter-chip inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700"
          title="Filter: status"
        >
          {statuses.length ? statuses.join(", ") : "All statuses"}
        </span>
      </div>

      <button
        type="button"
        onClick={download}
        className="toolbar-btn--primary mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
      >
        <Download className="size-4" />
        Download XLSX
      </button>
    </div>
  );
}
