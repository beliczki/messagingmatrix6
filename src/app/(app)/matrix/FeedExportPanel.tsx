"use client";

import { useMemo, useState } from "react";
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

function uniqueMcOptions(messages: Message[]) {
  const seen = new Map<
    string,
    { key: string; label: string; messageId: number; count: number }
  >();
  for (const m of messages) {
    const key = `${m.number}${m.variant}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const label = m.name
      ? `MC${m.number}${m.variant} — ${m.name}`
      : `MC${m.number}${m.variant}`;
    seen.set(key, { key, label, messageId: m.id, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

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
  const isActiveOnly = statuses.length === 1 && statuses[0] === "ACTIVE";
  const ready = isSingleProduct && isActiveOnly;
  const product = isSingleProduct ? products[0] : null;

  const historyQ = useQuery({
    queryKey: ["feed-exports", product ?? ""],
    queryFn: () => (product ? fetchFeedExports(product) : Promise.resolve([])),
    enabled: !!product,
  });

  const [defaultMessageId, setDefaultMessageId] = useState<number | "">("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const mcOptions = useMemo(
    () => (ready ? uniqueMcOptions(filteredMessages) : []),
    [ready, filteredMessages],
  );

  const liveExport = useMemo(() => {
    if (!historyQ.data) return null;
    const uploaded = historyQ.data.filter((r) => r.uploadedToAdformAt);
    if (uploaded.length === 0) return null;
    return uploaded.sort((a, b) =>
      (b.uploadedToAdformAt ?? "").localeCompare(a.uploadedToAdformAt ?? ""),
    )[0];
  }, [historyQ.data]);

  if (!ready) {
    return (
      <div className="feed-export-panel feed-export-panel--gated rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" />
          <div>
            <div className="feed-export-panel__title font-medium">
              Feed export
            </div>
            <p className="mt-1 leading-snug">
              Filter to <strong>one product</strong> and{" "}
              <strong>ACTIVE-only status</strong> to enable export.
            </p>
            <p className="mt-1 text-[10px] text-amber-700">
              {!isSingleProduct
                ? products.length === 0
                  ? "No product selected."
                  : `${products.length} products selected.`
                : "Product OK."}
              {" · "}
              {!isActiveOnly
                ? statuses.length === 0
                  ? "No status selected."
                  : `Status: ${statuses.join(", ")}.`
                : "Status OK."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="feed-export-panel rounded-md border border-slate-200 bg-white p-3">
        <div className="feed-export-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Feed export · {product}
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
            No prior upload — first export.
          </div>
        )}

        <label className="form-field mt-3 block">
          <span className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Default for this export
          </span>
          <select
            value={defaultMessageId}
            onChange={(e) =>
              setDefaultMessageId(
                e.target.value === "" ? "" : Number(e.target.value),
              )
            }
            className="input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
          >
            <option value="">— no default row —</option>
            {mcOptions.map((o) => (
              <option key={o.key} value={o.messageId}>
                {o.label}
                {o.count > 1 ? ` (${o.count} variants)` : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={filteredMessages.length === 0}
          className="toolbar-btn--primary mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Download className="size-4" />
          Preview & Export
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
        defaultMessageId={
          defaultMessageId === "" ? null : (defaultMessageId as number)
        }
      />
    </>
  );
}
