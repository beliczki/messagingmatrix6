"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  CheckCircle2,
  Trash2,
  Upload as UploadIcon,
} from "lucide-react";

type Payload = {
  columns: string[];
  rows: Record<string, string>[];
  messageIds: number[];
  defaultRowIndex: number;
};

type FeedExportDetail = {
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
  payload: Payload | null;
};

async function fetchOne(id: number): Promise<FeedExportDetail | null> {
  const r = await fetch(`/api/feed-exports/${id}`, { credentials: "include" });
  if (!r.ok) return null;
  const data = (await r.json()) as { feedExport: FeedExportDetail };
  return data.feedExport;
}

export function FeedDetailView({ id }: { id: number }) {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({
    queryKey: ["feed-export", id],
    queryFn: () => fetchOne(id),
  });

  const markUploadedM = useMutation({
    mutationFn: async () => {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed-export", id] });
      qc.invalidateQueries({ queryKey: ["feed-exports"] });
    },
  });

  const deleteM = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/feed-exports/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "delete failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["feed-exports"] });
      router.push("/feeds");
    },
  });

  const row = q.data;
  const cols = row?.payload?.columns ?? [];
  const rows = row?.payload?.rows ?? [];
  const defaultIdx = row?.payload?.defaultRowIndex ?? -1;

  const tableHead = useMemo(
    () =>
      cols.map((c) => (
        <th
          key={c}
          className="feed-detail__col-header whitespace-nowrap border border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500"
        >
          {c}
        </th>
      )),
    [cols],
  );

  if (q.isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading…</div>;
  }
  if (!row) {
    return (
      <div className="p-6 text-sm text-rose-600">
        Feed export not found.{" "}
        <Link href="/feeds" className="underline">
          Back to feeds
        </Link>
      </div>
    );
  }

  return (
    <div className="feed-detail flex h-full flex-col">
      <header className="feed-detail__header border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/feeds"
            className="toolbar-btn flex items-center gap-1 rounded p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-slate-900">
              Feed export #{row.id} · {row.product} · v{row.feedVersion}
            </h1>
            <p className="text-xs text-slate-500">
              {row.rowCount} rows · default: {row.defaultLabel ?? "—"} ·
              exported {new Date(row.exportedAt).toLocaleString()}
              {row.exportedBy ? ` by ${row.exportedBy}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/feed-exports/${row.id}?download=1`}
              className="toolbar-btn--primary flex items-center gap-1.5 rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white"
            >
              <Download className="size-4" />
              Download XLSX
            </a>
            {!row.uploadedToAdformAt ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Mark v${row.feedVersion} for ${row.product} as uploaded to AdForm?`,
                      )
                    ) {
                      markUploadedM.mutate();
                    }
                  }}
                  disabled={markUploadedM.isPending}
                  className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  <UploadIcon className="size-4" />
                  Mark uploaded
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete export #${row.id}?`)) {
                      deleteM.mutate();
                    }
                  }}
                  disabled={deleteM.isPending}
                  className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100"
                >
                  <Trash2 className="size-4" />
                  Delete
                </button>
              </>
            ) : (
              <span className="status-badge status-badge--ok inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800">
                <CheckCircle2 className="size-3.5" />
                Uploaded {new Date(row.uploadedToAdformAt).toLocaleDateString()}
                {row.uploadedBy ? ` by ${row.uploadedBy}` : ""}
              </span>
            )}
          </div>
        </div>
        {row.notes ? (
          <p className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
            <strong>Notes:</strong> {row.notes}
          </p>
        ) : null}
      </header>

      <div className="feed-detail__body flex-1 overflow-auto px-6 py-4">
        <table
          className="feed-detail__table border-collapse text-sm"
          style={{ width: "max-content", minWidth: "100%" }}
        >
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>{tableHead}</tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={idx}
                className={
                  idx === defaultIdx
                    ? "feed-detail__row feed-detail__row--default border-b border-slate-100 bg-amber-50"
                    : "feed-detail__row border-b border-slate-100 hover:bg-slate-50"
                }
              >
                {cols.map((c) => (
                  <td
                    key={c}
                    className="feed-detail__cell whitespace-pre-wrap break-words border border-slate-200 px-3 py-1.5 text-slate-700"
                    title={r[c] ?? ""}
                  >
                    {r[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
