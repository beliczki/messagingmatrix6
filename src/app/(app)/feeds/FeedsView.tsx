"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Check,
  Download,
  Trash2,
  ArrowUp,
  ArrowDown,
  Upload as UploadIcon,
} from "lucide-react";
import clsx from "clsx";
import MultiPill from "../_components/MultiPill";
import RightToolbar from "../_components/RightToolbar";
import { useAlertDialog } from "../_components/AlertDialog";

type FeedExportRow = {
  id: number;
  product: string;
  feedVersion: number;
  exportedAt: string;
  exportedBy: string | null;
  exportedByEmail: string | null;
  uploadedToAdformAt: string | null;
  uploadedBy: string | null;
  uploadedByEmail: string | null;
  defaultMessageId: number | null;
  defaultLabel: string | null;
  rowCount: number;
  notes: string | null;
  source: "export" | "adform_snapshot" | string;
};

type SortKey =
  | "exportedAt"
  | "product"
  | "feedVersion"
  | "defaultLabel"
  | "rowCount"
  | "live"
  | "uploadedToAdformAt"
  | "uploadedByEmail";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

async function fetchAll(): Promise<FeedExportRow[]> {
  const r = await fetch("/api/feed-exports", { credentials: "include" });
  if (!r.ok) return [];
  const data = (await r.json()) as { feedExports: FeedExportRow[] };
  return data.feedExports;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

const COLUMNS: Array<{ key: SortKey; label: string; width: number }> = [
  { key: "exportedAt", label: "Exported", width: 200 },
  { key: "product", label: "Product", width: 120 },
  { key: "feedVersion", label: "Version", width: 80 },
  { key: "defaultLabel", label: "Default", width: 280 },
  { key: "rowCount", label: "Rows", width: 80 },
  { key: "live", label: "Live", width: 80 },
  { key: "uploadedToAdformAt", label: "Published at", width: 200 },
  { key: "uploadedByEmail", label: "Published by", width: 220 },
];

const TOTAL_WIDTH = 40 + COLUMNS.reduce((s, c) => s + c.width, 0);
const ROW_HEIGHT = 32;

export function FeedsView() {
  const qc = useQueryClient();
  const dialog = useAlertDialog();
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState>({
    key: "exportedAt",
    dir: "desc",
  });

  const q = useQuery({
    queryKey: ["feed-exports", "all"],
    queryFn: fetchAll,
  });

  const productOptions = useMemo(() => {
    if (!q.data) return [];
    return [...new Set(q.data.map((r) => r.product))].sort();
  }, [q.data]);

  const filtered = useMemo(() => {
    if (!q.data) return [];
    let out = q.data.filter((r) => {
      if (products.size > 0 && !products.has(r.product)) return false;
      return true;
    });
    if (sort) {
      out = out.slice().sort((a, b) => {
        const cmp = compareRows(a, b, sort.key);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [q.data, products, sort]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((r) => selected.has(r.id));

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected],
  );

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

  // AdForm reference upload — server infers the product from PMMID audience
  // keys, so the user doesn't have to filter or pick one. The uploaded XLSX
  // must match Settings → Structure → Feed structure verbatim (server
  // enforces); otherwise the diff would be meaningless. The resulting row
  // appears in the feeds table directly (source='adform_snapshot') — no
  // separate sidebar listing needed.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const uploadM = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch("/api/adform-snapshots", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.reason ?? body.error ?? `${r.status}`);
      }
      return r.json();
    },
    onSuccess: () => {
      setSnapshotError(null);
      qc.invalidateQueries({ queryKey: ["feed-exports"] });
    },
    onError: (e) => setSnapshotError((e as Error).message),
  });

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function toggleSelectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  function toggleRowSelection(rowId: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedId !== null) {
        const startIdx = filteredIds.indexOf(lastClickedId);
        const endIdx = filteredIds.indexOf(rowId);
        if (startIdx >= 0 && endIdx >= 0) {
          const [lo, hi] =
            startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const shouldAdd = !prev.has(rowId);
          for (let i = lo; i <= hi; i++) {
            const id = filteredIds[i]!;
            if (shouldAdd) next.add(id);
            else next.delete(id);
          }
          return next;
        }
      }
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
    setLastClickedId(rowId);
  }

  function handleRowClick(
    e: React.MouseEvent<HTMLDivElement>,
    rowId: number,
  ) {
    if ((e.target as HTMLElement).closest("a")) return;
    toggleRowSelection(rowId, e.shiftKey);
  }

  function downloadSelected() {
    for (const r of selectedRows) {
      const a = document.createElement("a");
      a.href = `/api/feed-exports/${r.id}?download=1`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  async function publishSelected() {
    const targets = selectedRows.filter(
      (r) => r.source !== "adform_snapshot" && !r.uploadedToAdformAt,
    );
    if (targets.length === 0) return;
    const ok = await dialog.confirm({
      title: `Set ${targets.length} export${targets.length === 1 ? "" : "s"} as published?`,
      message:
        "Each becomes the live snapshot future exports diff against.",
      confirmLabel: "Set as Published",
      variant: "info",
    });
    if (!ok) return;
    for (const r of targets) markUploadedM.mutate(r.id);
  }

  async function deleteSelected() {
    if (selectedDeletable.length === 0) return;
    const ok = await dialog.confirm({
      title: `Delete ${selectedDeletable.length} feed${selectedDeletable.length === 1 ? "" : "s"}?`,
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    for (const r of selectedDeletable) deleteM.mutate(r.id);
    setSelected(new Set());
  }

  const selectedCount = selectedRows.length;
  // MM6 exports can only be deleted before they're marked as uploaded
  // (sticky-superset relies on the latest uploaded as baseline). AdForm
  // snapshots are user-managed mirrors, deletable any time.
  const selectedDeletable = selectedRows.filter(
    (r) => r.source === "adform_snapshot" || !r.uploadedToAdformAt,
  );
  const selectedDeletableCount = selectedDeletable.length;
  const selectedPublishableCount = selectedRows.filter(
    (r) => r.source !== "adform_snapshot" && !r.uploadedToAdformAt,
  ).length;

  return (
    <div className="feeds-view flex h-full">
      <div className="feeds-view__content flex flex-1 flex-col overflow-hidden">
        <header className="feeds-view__toolbar toolbar sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="toolbar__title text-sm font-semibold text-slate-900">
              Feeds
            </h1>
          </div>
          <MultiPill
            label="Product"
            values={products}
            options={productOptions}
            onChange={setProducts}
          />
          <div className="toolbar__count ml-auto text-[11px] tabular-nums text-slate-500">
            {filtered.length}/{q.data?.length ?? 0}
            {selected.size > 0 ? ` · ${selected.size} selected` : ""}
          </div>
        </header>

        <div className="feeds-view__body relative flex-1 overflow-auto">
          {q.isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No feed yet. Build one or upload a reference.
            </p>
          ) : (
            <div style={{ width: TOTAL_WIDTH, position: "relative" }}>
              {/* Header */}
              <div
                className="feeds-table__header sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600"
                style={{ width: TOTAL_WIDTH }}
              >
                <div
                  className="feeds-table__cell--checkbox flex h-8 shrink-0 items-center justify-center border-r border-slate-200"
                  style={{ width: 40 }}
                >
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected;
                    }}
                    onChange={toggleSelectAllFiltered}
                    aria-label="Select all (filtered)"
                  />
                </div>
                {COLUMNS.map((c) => {
                  const sortIcon =
                    sort?.key === c.key ? (
                      sort.dir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : null;
                  return (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className="feeds-table__cell--header flex h-8 shrink-0 items-center gap-1 border-r border-slate-200 px-2 hover:bg-slate-100"
                      style={{ width: c.width }}
                      title={`Sort by ${c.label}`}
                    >
                      <span className="truncate">{c.label}</span>
                      {sortIcon}
                    </button>
                  );
                })}
              </div>

              {/* Body */}
              <div className="feeds-table__body">
                {filtered.map((r) => {
                  const isSelected = selected.has(r.id);
                  const live = r.uploadedToAdformAt !== null;
                  return (
                    <div
                      key={r.id}
                      onClick={(e) => handleRowClick(e, r.id)}
                      className={clsx(
                        "feeds-table__row flex cursor-pointer select-none border-b border-slate-100",
                        isSelected && "feeds-table__row--selected bg-blue-50",
                        !isSelected && "hover:bg-slate-50",
                      )}
                      style={{ height: ROW_HEIGHT, width: TOTAL_WIDTH }}
                    >
                      <div
                        className="feeds-table__cell--checkbox flex shrink-0 items-center justify-center border-r border-slate-100"
                        style={{ width: 40 }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          tabIndex={-1}
                          aria-label={`Select export #${r.id}`}
                        />
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs"
                        style={{ width: 200 }}
                      >
                        <Link
                          href={`/feeds/${r.id}`}
                          className="feeds-table__date-link truncate text-blue-600 hover:underline"
                          title={`Open feed export #${r.id}`}
                        >
                          {formatDate(r.exportedAt)}
                        </Link>
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-900"
                        style={{ width: 120 }}
                      >
                        <span className="truncate">{r.product}</span>
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 font-mono text-xs text-slate-900"
                        style={{ width: 80 }}
                      >
                        {r.source === "adform_snapshot" ? (
                          <span
                            className="feeds-table__source-badge rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-700"
                            title="Uploaded from AdForm as a reference baseline (not generated by MM6)"
                          >
                            Reference
                          </span>
                        ) : (
                          `v${r.feedVersion}`
                        )}
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-700"
                        style={{ width: 280 }}
                        title={r.defaultLabel ?? r.notes ?? ""}
                      >
                        <span className="truncate">
                          {r.defaultLabel ?? "—"}
                        </span>
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs tabular-nums text-slate-900"
                        style={{ width: 80 }}
                      >
                        {r.rowCount}
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs"
                        style={{ width: 80 }}
                      >
                        <span
                          className={clsx(
                            "feeds-table__live font-mono",
                            live ? "text-emerald-700" : "text-slate-400",
                          )}
                        >
                          {live ? "true" : "false"}
                        </span>
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-700"
                        style={{ width: 200 }}
                      >
                        <span className="truncate">
                          {r.uploadedToAdformAt
                            ? formatDate(r.uploadedToAdformAt)
                            : "—"}
                        </span>
                      </div>
                      <div
                        className="feeds-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-700"
                        style={{ width: 220 }}
                        title={r.uploadedByEmail ?? r.uploadedBy ?? ""}
                      >
                        <span className="truncate">
                          {r.uploadedByEmail ?? r.uploadedBy ?? "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <RightToolbar storageKey="mm6_feeds_right_toolbar_open">
        {(collapsed) => (
          <div
            className={clsx(
              "feeds-view__right-toolbar-content h-full",
              collapsed ? "flex flex-col items-center gap-2" : "flex flex-col gap-3",
            )}
          >
            {!collapsed ? (
              <p className="feeds-view__right-toolbar-hint text-[11px] leading-relaxed text-slate-500">
                AdForm-aware feed export history. Build new feeds from{" "}
                <Link
                  href="/matrix"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Matrix → Feed view
                </Link>
                .
              </p>
            ) : null}

            {selectedCount > 0 ? (
              <div
                className={clsx(
                  "selection-actions flex flex-col gap-2 border-t border-slate-200 pt-3",
                  collapsed && "items-center",
                )}
              >
                {!collapsed ? (
                  <div className="selection-actions__count text-[11px] font-semibold text-slate-700">
                    {selectedCount} selected
                  </div>
                ) : (
                  <span
                    className="selection-actions__count flex size-8 items-center justify-center rounded-md bg-slate-900 text-[11px] font-semibold text-white"
                    title={`${selectedCount} selected`}
                  >
                    {selectedCount}
                  </span>
                )}

                <button
                  type="button"
                  onClick={publishSelected}
                  disabled={
                    markUploadedM.isPending || selectedPublishableCount === 0
                  }
                  title={
                    selectedPublishableCount === 0
                      ? "Selected rows can't be published (snapshots or already live)"
                      : `Set ${selectedPublishableCount} as published`
                  }
                  aria-label="Set selected as published"
                  className={clsx(
                    "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
                    collapsed ? "size-9" : "px-3 py-1.5 text-xs font-medium",
                  )}
                >
                  <Check className="size-3.5" />
                  {!collapsed ? "Set as Published" : null}
                </button>
              </div>
            ) : null}

            {selectedCount > 0 ? (
              <div
                className={clsx(
                  "feeds-view__bottom-actions flex gap-2",
                  collapsed ? "flex-col items-center" : "flex-row",
                )}
              >
                <button
                  type="button"
                  onClick={downloadSelected}
                  title={`Download ${selectedCount} XLSX file${selectedCount === 1 ? "" : "s"}`}
                  aria-label="Download selected"
                  className={clsx(
                    "toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800",
                    collapsed ? "size-9" : "flex-1 px-3 py-1.5 text-xs",
                  )}
                >
                  <Download className="size-3.5" />
                  {!collapsed ? "Download" : null}
                </button>
                <button
                  type="button"
                  onClick={deleteSelected}
                  disabled={deleteM.isPending || selectedDeletableCount === 0}
                  title={
                    selectedDeletableCount === 0
                      ? "Selected rows can't be deleted (already-published exports are immutable)"
                      : `Delete ${selectedDeletableCount} feed${selectedDeletableCount === 1 ? "" : "s"}`
                  }
                  aria-label="Delete selected"
                  className={clsx(
                    "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
                    collapsed ? "size-9" : "size-9 shrink-0",
                  )}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ) : null}

            <div
              className={clsx(
                "adform-snapshot-upload mt-auto flex flex-col gap-2",
                collapsed && "items-center",
              )}
            >
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadM.isPending}
                title="Upload feed reference (product inferred from file)"
                aria-label="Upload feed reference"
                className={clsx(
                  "toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40",
                  collapsed ? "size-9" : "px-3 py-1.5 text-xs",
                )}
              >
                <UploadIcon className="size-3.5" />
                {!collapsed
                  ? uploadM.isPending
                    ? "Uploading…"
                    : "Upload feed reference"
                  : null}
              </button>
              {!collapsed ? (
                <>
                  <p className="text-[10px] leading-snug text-slate-500">
                    Uploaded feed must match Settings → Structure → Feed
                    structure, otherwise upload will be dropped.
                  </p>
                  {snapshotError ? (
                    <p className="text-[10px] leading-snug text-rose-600">
                      {snapshotError}
                    </p>
                  ) : null}
                </>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadM.mutate(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )}
      </RightToolbar>
    </div>
  );
}

function compareRows(a: FeedExportRow, b: FeedExportRow, key: SortKey): number {
  if (key === "live") {
    const av = a.uploadedToAdformAt ? 1 : 0;
    const bv = b.uploadedToAdformAt ? 1 : 0;
    return av - bv;
  }
  const av = a[key as keyof FeedExportRow];
  const bv = b[key as keyof FeedExportRow];
  if (av === bv) return 0;
  if (av === null || av === undefined) return -1;
  if (bv === null || bv === undefined) return 1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}
