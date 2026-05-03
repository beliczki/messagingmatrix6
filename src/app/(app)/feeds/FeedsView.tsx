"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Download,
  ExternalLink,
  CheckCircle2,
  Trash2,
  Upload as UploadIcon,
} from "lucide-react";

type FeedExportRow = {
  id: number;
  product: string;
  feedVersion: number;
  exportedAt: string;
  exportedBy: string | null;
  uploadedToAdformAt: string | null;
  uploadedBy: string | null;
  defaultMessageId: number | null;
  defaultLabel: string | null;
  rowCount: number;
  notes: string | null;
};

async function fetchAll(): Promise<FeedExportRow[]> {
  const r = await fetch("/api/feed-exports", { credentials: "include" });
  if (!r.ok) return [];
  const data = (await r.json()) as { feedExports: FeedExportRow[] };
  return data.feedExports;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function FeedsView() {
  const qc = useQueryClient();
  const [productFilter, setProductFilter] = useState<string>("");
  const [showUploadedOnly, setShowUploadedOnly] = useState(false);

  const q = useQuery({
    queryKey: ["feed-exports", "all"],
    queryFn: fetchAll,
  });

  const products = useMemo(() => {
    if (!q.data) return [];
    return [...new Set(q.data.map((r) => r.product))].sort();
  }, [q.data]);

  const filtered = useMemo(() => {
    if (!q.data) return [];
    return q.data.filter((r) => {
      if (productFilter && r.product !== productFilter) return false;
      if (showUploadedOnly && !r.uploadedToAdformAt) return false;
      return true;
    });
  }, [q.data, productFilter, showUploadedOnly]);

  const markUploadedM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/feed-exports/${id}/mark-uploaded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "mark failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed-exports"] }),
  });

  const deleteM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/feed-exports/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "delete failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feed-exports"] }),
  });

  function confirmMarkUploaded(row: FeedExportRow) {
    const ok = window.confirm(
      `Mark v${row.feedVersion} for ${row.product} (${row.rowCount} rows) as uploaded to AdForm?\n\nThis becomes the live snapshot future exports diff against.`,
    );
    if (ok) markUploadedM.mutate(row.id);
  }

  function confirmDelete(row: FeedExportRow) {
    const ok = window.confirm(
      `Delete export #${row.id} (v${row.feedVersion}, ${row.product})? This cannot be undone.`,
    );
    if (ok) deleteM.mutate(row.id);
  }

  return (
    <div className="feeds-view flex h-full flex-col">
      <header className="feeds-view__header flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Feeds</h1>
          <p className="text-xs text-slate-500">
            AdForm-aware feed export history. Build new feeds from{" "}
            <Link
              href="/matrix"
              className="font-medium text-blue-600 hover:underline"
            >
              Matrix → Feed view
            </Link>
            .
          </p>
        </div>
      </header>

      <div className="feeds-view__filters flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-6 py-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-slate-600">Product:</span>
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="input-box rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">All</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showUploadedOnly}
            onChange={(e) => setShowUploadedOnly(e.target.checked)}
          />
          <span className="text-slate-600">Uploaded only</span>
        </label>
        <span className="ml-auto text-slate-500">
          {filtered.length} export{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="feeds-view__body flex-1 overflow-auto px-6 py-4">
        {q.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500">
            No exports yet. Build the first one from Matrix → Feed view.
          </p>
        ) : (
          <table className="feeds-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2">Version</th>
                <th className="px-2 py-2">Default</th>
                <th className="px-2 py-2">Rows</th>
                <th className="px-2 py-2">Exported</th>
                <th className="px-2 py-2">Uploaded</th>
                <th className="px-2 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="feeds-table__row border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="feeds-table__cell px-2 py-1.5 font-mono text-xs text-slate-600">
                    #{r.id}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5">
                    {r.product}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 font-mono">
                    v{r.feedVersion}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 text-xs text-slate-600">
                    {r.defaultLabel ?? "—"}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 tabular-nums">
                    {r.rowCount}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 text-xs text-slate-500">
                    <div>{formatDate(r.exportedAt)}</div>
                    <div className="text-[10px] text-slate-400">
                      {r.exportedBy ?? ""}
                    </div>
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 text-xs">
                    {r.uploadedToAdformAt ? (
                      <span className="status-badge status-badge--ok inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                        <CheckCircle2 className="size-3" />
                        Uploaded
                      </span>
                    ) : (
                      <span className="status-badge inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                        Local only
                      </span>
                    )}
                  </td>
                  <td className="feeds-table__cell px-2 py-1.5 text-right">
                    <div className="inline-flex gap-1">
                      <Link
                        href={`/feeds/${r.id}`}
                        className="toolbar-btn rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100"
                        title="Open detail"
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                      <a
                        href={`/api/feed-exports/${r.id}?download=1`}
                        className="toolbar-btn rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-600 hover:bg-slate-100"
                        title="Download XLSX"
                      >
                        <Download className="size-3.5" />
                      </a>
                      {!r.uploadedToAdformAt ? (
                        <>
                          <button
                            type="button"
                            onClick={() => confirmMarkUploaded(r)}
                            disabled={markUploadedM.isPending}
                            className="toolbar-btn rounded border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-emerald-700 hover:bg-emerald-100"
                            title="Mark as uploaded to AdForm"
                          >
                            <UploadIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => confirmDelete(r)}
                            disabled={deleteM.isPending}
                            className="toolbar-btn rounded border border-rose-200 bg-rose-50 px-1.5 py-1 text-rose-700 hover:bg-rose-100"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
