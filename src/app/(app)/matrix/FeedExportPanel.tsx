"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type Filters, type Message } from "./types";
import FeedExportDialog from "./FeedExportDialog";


type FeedExportRow = {
  id: number;
  product: string;
  feedVersion: number;
  exportedAt: string;
  uploadedToAdformAt: string | null;
  defaultLabel: string | null;
  rowCount: number;
};

async function fetchFeedExports(product: string): Promise<FeedExportRow[]> {
  const r = await fetch(
    `/api/feed-exports?product=${encodeURIComponent(product)}`,
    { credentials: "include" },
  );
  if (!r.ok) return [];
  const data = (await r.json()) as { feedExports: FeedExportRow[] };
  return data.feedExports;
}

const SERVING_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

export default function FeedExportPanel({
  filters,
  filteredMessages,
}: {
  filters: Filters;
  filteredMessages: Message[];
}) {
  const products = [...filters.products];
  const statuses = [...filters.statuses];
  const isSingleProduct = products.length === 1;
  // ACTIVE and INACTIVE are the two "serving" statuses that belong in an AdForm
  // feed (INACTIVE rows go in with ISACTIVE=FALSE). Pre-serving and abandoned
  // statuses (PREVIEW, APPROVED, DEAD) must never be exported, so the gate
  // requires the status filter to be a non-empty subset of the serving set.
  // DRAFT cannot reach here at all — the export query is placed-rows-only.
  const isServingStatusOnly =
    statuses.length > 0 && statuses.every((s) => SERVING_STATUSES.has(s));
  const ready = isSingleProduct && isServingStatusOnly;
  const product = isSingleProduct ? products[0] : null;

  const historyQ = useQuery({
    queryKey: ["feed-exports", product ?? ""],
    queryFn: () => (product ? fetchFeedExports(product) : Promise.resolve([])),
    enabled: !!product,
  });

  const [dialogOpen, setDialogOpen] = useState(false);

  const liveExport = useMemo(() => {
    if (!historyQ.data) return null;
    const uploaded = historyQ.data.filter((r) => r.uploadedToAdformAt);
    if (uploaded.length === 0) return null;
    return uploaded.sort((a, b) =>
      (b.uploadedToAdformAt ?? "").localeCompare(a.uploadedToAdformAt ?? ""),
    )[0];
  }, [historyQ.data]);

  // Must stay above the early return below — a hook called only on the `ready`
  // branch would change the hook order when the status filter flips `ready`,
  // crashing with "rendered more hooks than during the previous render".
  const filteredIds = useMemo(
    () => filteredMessages.map((m) => m.id),
    [filteredMessages],
  );

  if (!ready) {
    return (
      <div className="feed-export-panel feed-export-panel--gated rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" />
          <div>
            <div className="feed-export-panel__title font-medium">
              Feed export
            </div>
            <p className="mt-1 leading-snug">
              Filter to <strong>one product</strong> and{" "}
              <strong>ACTIVE / INACTIVE status</strong> to enable export.
            </p>
            <p className="mt-1 text-[10px] text-amber-700">
              {!isSingleProduct
                ? products.length === 0
                  ? "No product selected."
                  : `${products.length} products selected.`
                : "Product OK."}
              {" · "}
              {!isServingStatusOnly
                ? statuses.length === 0
                  ? "No status selected."
                  : `Status: ${statuses.join(", ")} (only ACTIVE/INACTIVE allowed).`
                : "Status OK."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const filterChips: Array<{ key: string; label: string }> = [
    { key: "product", label: product! },
  ];
  const trimmedSearch = filters.search.trim();
  if (trimmedSearch) {
    filterChips.push({ key: "search", label: trimmedSearch });
  }
  filterChips.push({ key: "status", label: statuses.join(", ") });

  return (
    <>
      <div className="feed-export-panel rounded-md border border-slate-200 bg-white p-3">
        <div className="feed-export-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Feed export
        </div>

        <div className="feed-export-panel__filters mt-2 flex flex-wrap items-center gap-1.5">
          {filterChips.map((c) => (
            <span
              key={c.key}
              className="filter-chip inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700"
              title={`Filter: ${c.key}`}
            >
              {c.label}
            </span>
          ))}
          <span className="feed-export-panel__row-count ml-auto text-[10px] tabular-nums text-slate-500">
            {filteredMessages.length} row
            {filteredMessages.length === 1 ? "" : "s"}
          </span>
        </div>

        {liveExport ? (
          <div className="feed-export-panel__live mt-2 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
            <div className="font-medium text-slate-700">
              Live: v{liveExport.feedVersion}
            </div>
            <div className="text-[10px]">
              Default: {liveExport.defaultLabel ?? "—"}
            </div>
            <div className="text-[10px] text-slate-400">
              uploaded {new Date(liveExport.uploadedToAdformAt!).toLocaleDateString()}
            </div>
          </div>
        ) : (
          <div className="feed-export-panel__live mt-2 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
            No published feed for {product} yet.
          </div>
        )}

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={filteredMessages.length === 0}
          className="toolbar-btn--primary mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Download className="size-4" />
          Export
        </button>

        {historyQ.data && historyQ.data.length > 0 ? (
          <div className="mt-3 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <Link
              href="/feeds"
              className="hover:underline"
            >
              {historyQ.data.length} export{historyQ.data.length === 1 ? "" : "s"} for {product} →
            </Link>
          </div>
        ) : null}
      </div>

      <FeedExportDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        product={product!}
        messages={filteredMessages}
        messageIds={filteredIds}
      />
    </>
  );
}
