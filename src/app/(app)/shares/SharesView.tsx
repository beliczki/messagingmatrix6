"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive as ArchiveIcon,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
} from "lucide-react";
import clsx from "clsx";
import ArchiveToggle from "../_components/ArchiveToggle";
import RightToolbar from "../_components/RightToolbar";
import { useAlertDialog } from "../_components/AlertDialog";

type Share = {
  id: string;
  title: string | null;
  description: string | null;
  createdBy: string | null;
  createdByEmail: string | null;
  createdAt: string;
  archivedAt: string | null;
  messageCount: number;
  commentCount: number;
  viewCount: number;
  downloadCount: number;
};

type SortKey =
  | "title"
  | "id"
  | "createdAt"
  | "messageCount"
  | "commentCount"
  | "viewCount"
  | "downloadCount"
  | "createdByEmail";
type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

const COLUMNS: Array<{ key: SortKey; label: string; width: number }> = [
  { key: "title", label: "Title", width: 280 },
  { key: "id", label: "URL", width: 180 },
  { key: "createdAt", label: "Created", width: 180 },
  { key: "messageCount", label: "Items", width: 70 },
  { key: "commentCount", label: "Comments", width: 90 },
  { key: "viewCount", label: "Views", width: 70 },
  { key: "downloadCount", label: "Downloads", width: 100 },
  { key: "createdByEmail", label: "Created by", width: 200 },
];

const TOTAL_WIDTH = 40 + COLUMNS.reduce((s, c) => s + c.width, 0);
const ROW_HEIGHT = 32;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SharesView() {
  const qc = useQueryClient();
  const dialog = useAlertDialog();
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({
    key: "createdAt",
    dir: "desc",
  });

  const sharesQ = useQuery({
    queryKey: ["share-galleries", { showArchived }],
    queryFn: async (): Promise<Share[]> => {
      const url = showArchived
        ? "/api/share-galleries?includeArchived=1"
        : "/api/share-galleries";
      const r = await fetch(url);
      if (!r.ok) throw new Error("shares fetch failed");
      const data = (await r.json()) as { shares: Share[] };
      return data.shares;
    },
  });

  const archiveM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/share-galleries/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "archive failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["share-galleries"] });
    },
  });
  const restoreM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/share-galleries/${id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "restore failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["share-galleries"] });
    },
  });

  const rows = sharesQ.data ?? [];

  const filtered = useMemo(() => {
    const out = rows.slice();
    if (sort) {
      out.sort((a, b) => {
        const cmp = compareRows(a, b, sort.key);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, sort]);

  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someFilteredSelected =
    !allFilteredSelected && filtered.some((r) => selected.has(r.id));

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.id)),
    [filtered, selected],
  );

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

  function toggleRowSelection(rowId: string, shiftKey: boolean) {
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
    rowId: string,
  ) {
    if ((e.target as HTMLElement).closest("a")) return;
    toggleRowSelection(rowId, e.shiftKey);
  }

  async function copySelected() {
    if (selectedRows.length === 0) return;
    const origin = window.location.origin;
    const text = selectedRows
      .map((r) => `${origin}/share/${r.id}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      await dialog.alert({
        title: "Couldn't copy to clipboard",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }

  async function archiveSelected() {
    const targets = selectedRows.filter((r) => r.archivedAt === null);
    if (targets.length === 0) return;
    const ok = await dialog.confirm({
      title: `Archive ${targets.length} share${targets.length === 1 ? "" : "s"}?`,
      message: "The public link will stop working until restored.",
      confirmLabel: "Archive",
      variant: "warning",
    });
    if (!ok) return;
    for (const r of targets) archiveM.mutate(r.id);
  }

  async function restoreSelected() {
    const targets = selectedRows.filter((r) => r.archivedAt !== null);
    if (targets.length === 0) return;
    for (const r of targets) restoreM.mutate(r.id);
  }

  const selectedCount = selectedRows.length;
  const selectedActiveCount = selectedRows.filter(
    (r) => r.archivedAt === null,
  ).length;
  const selectedArchivedCount = selectedRows.filter(
    (r) => r.archivedAt !== null,
  ).length;

  return (
    <div className="shares flex h-full">
      <div className="shares__content flex flex-1 flex-col overflow-hidden">
        <header className="shares__toolbar toolbar sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex items-baseline gap-2">
            <h1 className="toolbar__title text-sm font-semibold text-slate-900">
              Shares
            </h1>
          </div>
          <div className="toolbar__count ml-auto text-[11px] tabular-nums text-slate-500">
            {filtered.length}/{rows.length}
            {selected.size > 0 ? ` · ${selected.size} selected` : ""}
          </div>
        </header>

        <div className="shares__body relative flex-1 overflow-auto">
          {sharesQ.isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : sharesQ.isError ? (
            <p className="error-alert m-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load shares.
            </p>
          ) : filtered.length === 0 ? (
            <div className="empty-state mx-auto mt-12 max-w-md rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm text-slate-500">
                No shares yet. Create new shares from{" "}
                <Link
                  href="/creative-library"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Creative Library
                </Link>
                {" "}by selecting creatives.
              </p>
            </div>
          ) : (
            <div style={{ width: TOTAL_WIDTH, position: "relative" }}>
              {/* Header */}
              <div
                className="shares-table__header sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600"
                style={{ width: TOTAL_WIDTH }}
              >
                <div
                  className="shares-table__cell--checkbox flex h-8 shrink-0 items-center justify-center border-r border-slate-200"
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
                      className="shares-table__cell--header flex h-8 shrink-0 items-center gap-1 border-r border-slate-200 px-2 hover:bg-slate-100"
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
              <div className="shares-table__body">
                {filtered.map((r) => {
                  const isSelected = selected.has(r.id);
                  const archived = r.archivedAt !== null;
                  const linkClass = clsx(
                    "truncate text-blue-600 hover:underline",
                    archived && "pointer-events-none opacity-60",
                  );
                  const linkTitle = archived
                    ? "Archived shares aren't viewable"
                    : `Open public share /share/${r.id}`;
                  return (
                    <div
                      key={r.id}
                      onClick={(e) => handleRowClick(e, r.id)}
                      className={clsx(
                        "shares-table__row flex cursor-pointer select-none border-b border-slate-100",
                        isSelected && "shares-table__row--selected bg-blue-50",
                        !isSelected && "hover:bg-slate-50",
                        archived && "shares-table__row--archived opacity-60",
                      )}
                      style={{ height: ROW_HEIGHT, width: TOTAL_WIDTH }}
                    >
                      <div
                        className="shares-table__cell--checkbox flex shrink-0 items-center justify-center border-r border-slate-100"
                        style={{ width: 40 }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          tabIndex={-1}
                          aria-label={`Select share ${r.title ?? r.id}`}
                        />
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs"
                        style={{ width: 280 }}
                        title={r.title ?? "(untitled)"}
                      >
                        <a
                          href={`/share/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={linkClass}
                          title={linkTitle}
                        >
                          {r.title ?? (
                            <span className="italic text-slate-400">
                              untitled
                            </span>
                          )}
                        </a>
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs"
                        style={{ width: 180 }}
                        title={`/share/${r.id}`}
                      >
                        <a
                          href={`/share/${r.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={clsx(linkClass, "font-mono")}
                          title={linkTitle}
                        >
                          {r.id}
                        </a>
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-700"
                        style={{ width: 180 }}
                      >
                        <span className="truncate">
                          {formatDate(r.createdAt)}
                        </span>
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs tabular-nums text-slate-900"
                        style={{ width: 70 }}
                      >
                        {r.messageCount}
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs tabular-nums text-slate-900"
                        style={{ width: 90 }}
                      >
                        {r.commentCount}
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs tabular-nums text-slate-900"
                        style={{ width: 70 }}
                      >
                        {r.viewCount}
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs tabular-nums text-slate-900"
                        style={{ width: 100 }}
                      >
                        {r.downloadCount}
                      </div>
                      <div
                        className="shares-table__cell flex shrink-0 items-center border-r border-slate-100 px-2 text-xs text-slate-700"
                        style={{ width: 200 }}
                        title={r.createdByEmail ?? r.createdBy ?? ""}
                      >
                        <span className="truncate">
                          {r.createdByEmail ?? r.createdBy ?? "—"}
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

      <RightToolbar storageKey="mm6_shares_right_toolbar_open">
        {(collapsed) => (
          <div
            className={clsx(
              "shares__right-toolbar-content h-full",
              collapsed ? "flex flex-col items-center gap-2" : "flex flex-col gap-3",
            )}
          >
            {!collapsed ? (
              <p className="shares__right-toolbar-hint text-[11px] leading-relaxed text-slate-500">
                Create new shares from{" "}
                <Link
                  href="/creative-library"
                  className="font-medium text-blue-600 hover:underline"
                >
                  Creative Library
                </Link>
                {" "}by selecting creatives.
              </p>
            ) : null}

            <ArchiveToggle
              showArchived={showArchived}
              onChange={setShowArchived}
              collapsed={collapsed}
            />

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
                  onClick={archiveSelected}
                  disabled={archiveM.isPending || selectedActiveCount === 0}
                  title={
                    selectedActiveCount === 0
                      ? "Selected shares are already archived"
                      : `Archive ${selectedActiveCount} share${selectedActiveCount === 1 ? "" : "s"}`
                  }
                  aria-label="Archive selected"
                  className={clsx(
                    "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
                    collapsed ? "size-9" : "px-3 py-1.5 text-xs font-medium",
                  )}
                >
                  <ArchiveIcon className="size-3.5" />
                  {!collapsed ? "Archive" : null}
                </button>

                <button
                  type="button"
                  onClick={restoreSelected}
                  disabled={restoreM.isPending || selectedArchivedCount === 0}
                  title={
                    selectedArchivedCount === 0
                      ? "No archived shares in selection"
                      : `Restore ${selectedArchivedCount} share${selectedArchivedCount === 1 ? "" : "s"}`
                  }
                  aria-label="Restore selected"
                  className={clsx(
                    "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
                    collapsed ? "size-9" : "px-3 py-1.5 text-xs font-medium",
                  )}
                >
                  <ArchiveRestore className="size-3.5" />
                  {!collapsed ? "Restore" : null}
                </button>
              </div>
            ) : null}

            {selectedCount > 0 ? (
              <div
                className={clsx(
                  "shares__bottom-actions mt-auto flex gap-2",
                  collapsed ? "flex-col items-center" : "flex-row",
                )}
              >
                <button
                  type="button"
                  onClick={copySelected}
                  title={`Copy ${selectedCount} public link${selectedCount === 1 ? "" : "s"}`}
                  aria-label="Copy public link"
                  className={clsx(
                    "toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800",
                    collapsed ? "size-9" : "flex-1 px-3 py-1.5 text-xs",
                  )}
                >
                  <Copy className="size-3.5" />
                  {!collapsed ? "Copy link" : null}
                </button>
                {selectedCount === 1 ? (
                  <a
                    href={`/share/${selectedRows[0]!.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open public page"
                    aria-label="Open public page"
                    className={clsx(
                      "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                      selectedRows[0]!.archivedAt !== null &&
                        "pointer-events-none opacity-40",
                      collapsed ? "size-9" : "size-9 shrink-0",
                    )}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </RightToolbar>
    </div>
  );
}

function compareRows(a: Share, b: Share, key: SortKey): number {
  const av = a[key];
  const bv = b[key];
  if (av === bv) return 0;
  if (av === null || av === undefined) return -1;
  if (bv === null || bv === undefined) return 1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}
