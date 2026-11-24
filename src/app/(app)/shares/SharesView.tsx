"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/app/_icons/Icon";
import clsx from "clsx";
import { AppBrandTag } from "@/app/_components/AppBrandTag";
import ArchiveToggle from "../_components/ArchiveToggle";
import RightToolbar from "../_components/RightToolbar";
import { useAlertDialog } from "../_components/AlertDialog";
import MultiPill, {
  ALL_NONE_QUICK_SELECT,
  EMPTY_OPTION,
  withEmptyOption,
} from "../_components/MultiPill";
import ToggleBtn from "../_components/ToggleBtn";
import CycleIconButton from "../_components/CycleIconButton";
import {
  SET_CODEC,
  STRING_CODEC,
  usePersistent,
  type Codec,
} from "../_components/usePersistent";
import { parseSearchQuery } from "@/lib/search-query";
import { shareRowMatches } from "@/lib/share-list";
import type { RefreshPreviewItem, SharePreview } from "@/lib/share-snapshot";

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
  /** Every MC and variant in the share, one picture each, in viewer order. */
  previews: SharePreview[];
  products: string[];
  /** The text on the share's creatives, one line each — for the filter. */
  searchText: string;
};

// The preview thumbnails' height, picked in the right toolbar's View box.
type PreviewHeight = 32 | 64 | 128 | 256;
const PREVIEW_HEIGHTS: PreviewHeight[] = [32, 64, 128, 256];
const PREVIEW_HEIGHT_CODEC: Codec<PreviewHeight> = {
  parse: (s) => PREVIEW_HEIGHTS.find((h) => String(h) === s) ?? 64,
  stringify: (h) => String(h),
};
// One square box per thumbnail, as a class rather than an inline style.
const THUMB_BOX: Record<PreviewHeight, string> = {
  32: "size-8",
  64: "size-16",
  128: "size-32",
  256: "size-64",
};
// The share file proxy's width tiers (80/200/400/800): about twice the box,
// so the still is sharp on a retina screen.
const THUMB_WIDTH: Record<PreviewHeight, number> = {
  32: 80,
  64: 200,
  128: 400,
  256: 800,
};
const PREVIEWS_PER_PAGE = 3;
// ‹ + 3 boxes + › with 4px gaps, plus the cell's padding and border.
function previewColumnWidth(h: PreviewHeight): number {
  return PREVIEWS_PER_PAGE * h + 2 * 20 + 4 * 4 + 16 + 1;
}

const SEARCH_HELP = [
  "Free text searches the share's name, its MCs and the text on its creatives.",
  "mc: matches an MC (mc:12a).",
  'AND implicit, OR explicit. Quote "two words" for phrases.',
].join(" ");

type RefreshPair = { from: RefreshPreviewItem; to: RefreshPreviewItem };
type RefreshPreviewShare = { share: Share; replaced: RefreshPair[] };

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
  const [previewing, setPreviewing] = useState(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({
    key: "createdAt",
    dir: "desc",
  });
  const [search, setSearch] = usePersistent(
    "mm6_shares_filter_search",
    "",
    STRING_CODEC,
  );
  const [products, setProducts] = usePersistent<Set<string>>(
    "mm6_shares_filter_products",
    new Set(),
    SET_CODEC,
  );
  const [previewHeight, setPreviewHeight] = usePersistent<PreviewHeight>(
    "mm6_shares_preview_height",
    64,
    PREVIEW_HEIGHT_CODEC,
  );

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

  const refreshM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/share-galleries/${id}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "refresh failed");
      }
    },
    onError: async (err) => {
      await dialog.alert({
        title: "Couldn't refresh share",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    },
  });

  const rows = useMemo(() => sharesQ.data ?? [], [sharesQ.data]);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const p of r.products) s.add(p);
    return withEmptyOption(
      [...s].sort(),
      rows.some((r) => r.products.length === 0),
    );
  }, [rows]);

  const predicate = useMemo(() => parseSearchQuery(search), [search]);

  const filtered = useMemo(() => {
    const out = rows.filter((r) =>
      shareRowMatches(r, predicate, products, EMPTY_OPTION),
    );
    if (sort) {
      out.sort((a, b) => {
        const cmp = compareRows(a, b, sort.key);
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, sort, predicate, products]);

  const previewWidth = previewColumnWidth(previewHeight);
  const totalWidth = TOTAL_WIDTH + previewWidth;
  const rowHeight = Math.max(ROW_HEIGHT, previewHeight + 8);
  const activeFilters = products.size + (search ? 1 : 0);

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

  // The confirm dialog shows what each share's refresh would swap (n1 → n2),
  // asked from the server's own plan — the same one the refresh then runs.
  async function refreshSelected() {
    const targets = selectedRows.filter((r) => r.archivedAt === null);
    if (targets.length === 0) return;
    setPreviewing(true);
    let previews: RefreshPreviewShare[];
    try {
      previews = await Promise.all(
        targets.map(async (share) => {
          const r = await fetch(`/api/share-galleries/${share.id}/refresh`);
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.error ?? "refresh preview failed");
          }
          const body = (await r.json()) as { replaced: RefreshPair[] };
          return { share, replaced: body.replaced };
        }),
      );
    } catch (err) {
      await dialog.alert({
        title: "Couldn't check the shares",
        message: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
      return;
    } finally {
      setPreviewing(false);
    }
    const ok = await dialog.confirm({
      title: `Refresh ${targets.length} share${targets.length === 1 ? "" : "s"}?`,
      message: <RefreshPreview previews={previews} />,
      confirmLabel: "Refresh",
      variant: "info",
    });
    if (!ok) return;
    for (const r of targets) refreshM.mutate(r.id);
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
          <AppBrandTag />
          <div className="flex items-baseline gap-2">
            <h1 className="toolbar__title text-sm font-semibold text-slate-900">
              Shares
            </h1>
          </div>

          <div className="input-box input-box--with-icon relative">
            <Icon
              name="filter"
              className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
            />
            <input
              type="search"
              placeholder="Filter… name, text, mc: OR …"
              title={SEARCH_HELP}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
            />
          </div>

          <MultiPill
            label="Product"
            values={products}
            options={productOptions}
            quickSelect={ALL_NONE_QUICK_SELECT}
            onChange={setProducts}
          />

          {activeFilters > 0 ? (
            <button
              type="button"
              onClick={() => {
                setProducts(new Set());
                setSearch("");
              }}
              className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
            >
              <Icon name="close" className="size-3" />
              Clear
            </button>
          ) : null}

          <div className="toolbar__count ml-auto text-[11px] tabular-nums text-slate-500">
            {filtered.length}/{rows.length}
            {selectedRows.length > 0 ? ` · ${selectedRows.length} selected` : ""}
          </div>
        </header>

        <div className="shares__body relative flex-1 overflow-auto">
          {sharesQ.isLoading ? (
            <p className="p-6 text-sm text-slate-500">Loading…</p>
          ) : sharesQ.isError ? (
            <p className="error-alert m-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load shares.
            </p>
          ) : filtered.length === 0 && rows.length > 0 ? (
            <div className="empty-state mx-auto mt-12 max-w-md rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm text-slate-500">
                No shares match the filters. Clear filters or adjust the search
                to see all shares.
              </p>
            </div>
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
            <div style={{ width: totalWidth, position: "relative" }}>
              {/* Header */}
              <div
                className="shares-table__header sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600"
                style={{ width: totalWidth }}
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
                <div
                  className="shares-table__cell--header shares-table__cell--preview flex h-8 shrink-0 items-center border-r border-slate-200 px-2"
                  style={{ width: previewWidth }}
                  title="One picture per MC and variant; ‹ › steps through the rest"
                >
                  <span className="truncate">Preview</span>
                </div>
                {COLUMNS.map((c) => {
                  const sortIcon =
                    sort?.key === c.key ? (
                      sort.dir === "asc" ? (
                        <Icon name="arrow-up" className="size-3" />
                      ) : (
                        <Icon name="arrow-down" className="size-3" />
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
                      style={{ height: rowHeight, width: totalWidth }}
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
                        className="shares-table__cell shares-table__cell--preview flex shrink-0 items-center border-r border-slate-100 px-2"
                        style={{ width: previewWidth }}
                      >
                        <SharePreviewStrip
                          previews={r.previews}
                          height={previewHeight}
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

            <PreviewHeightControls
              height={previewHeight}
              setHeight={setPreviewHeight}
              collapsed={collapsed}
            />

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
                  onClick={refreshSelected}
                  disabled={refreshM.isPending || previewing || selectedActiveCount === 0}
                  title={
                    selectedActiveCount === 0
                      ? "Archived shares can't be refreshed"
                      : `Refresh ${selectedActiveCount} share${selectedActiveCount === 1 ? "" : "s"} to the current creatives`
                  }
                  aria-label="Refresh selected"
                  className={clsx(
                    "toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
                    collapsed ? "size-9" : "px-3 py-1.5 text-xs font-medium",
                  )}
                >
                  <Icon name="refresh" className="size-3.5" />
                  {!collapsed ? "Refresh" : null}
                </button>

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
                  <Icon name="archive" className="size-3.5" />
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
                  <Icon name="archive-restore" className="size-3.5" />
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
                  <Icon name="copy" className="size-3.5" />
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
                    <Icon name="external-link" className="size-3.5" />
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

// The right toolbar's View box: how tall the preview thumbnails are. Same
// section chrome as the matrix View/Density controls; collapsed, one button
// that cycles through the four heights.
function PreviewHeightControls({
  height,
  setHeight,
  collapsed,
}: {
  height: PreviewHeight;
  setHeight: (h: PreviewHeight) => void;
  collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <CycleIconButton
        options={PREVIEW_HEIGHTS.map((h) => ({
          value: h,
          label: `${h}px previews`,
          icon: (
            <span className="shares-view-controls__cycle-label text-[10px] font-semibold tabular-nums">
              {h}
            </span>
          ),
        }))}
        value={height}
        onChange={setHeight}
      />
    );
  }
  return (
    <div className="shares-view-controls">
      <div className="shares-view-controls__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        View
      </div>
      <div
        className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs tabular-nums"
        role="group"
        aria-label="Preview height"
      >
        {PREVIEW_HEIGHTS.map((h) => (
          <ToggleBtn
            key={h}
            active={height === h}
            onClick={() => setHeight(h)}
            title={`Preview thumbnails ${h}px tall`}
          >
            {h}
          </ToggleBtn>
        ))}
      </div>
    </div>
  );
}

// The Preview cell: three of the share's MCs at a time, ‹ › pages through the
// rest. Clicks on the arrows stay out of the row's select-on-click.
function SharePreviewStrip({
  previews,
  height,
}: {
  previews: SharePreview[];
  height: PreviewHeight;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(previews.length / PREVIEWS_PER_PAGE);
  // A refetch can shorten the list (a refresh merges a version already in the
  // share); stay on the last page that still exists.
  const current = Math.min(page, Math.max(pageCount - 1, 0));
  const start = current * PREVIEWS_PER_PAGE;
  const shown = previews.slice(start, start + PREVIEWS_PER_PAGE);
  const range = `MC ${start + 1}–${start + shown.length} of ${previews.length}`;
  const stepping = pageCount > 1;

  function step(e: React.MouseEvent, delta: number) {
    e.stopPropagation();
    setPage(current + delta);
  }

  const navClass = clsx(
    "share-preview-strip__nav nav-stepper__btn flex h-6 w-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent",
    !stepping && "invisible",
  );

  return (
    <div
      className="share-preview-strip flex items-center gap-1"
      title={stepping ? range : undefined}
    >
      <button
        type="button"
        onClick={(e) => step(e, -1)}
        disabled={!stepping || current === 0}
        aria-label="Previous MCs"
        title={stepping ? range : undefined}
        className={navClass}
      >
        <Icon name="chevron-left" className="size-3.5" />
      </button>
      {shown.map((p, i) => (
        <SharePreviewThumb key={start + i} preview={p} height={height} />
      ))}
      <button
        type="button"
        onClick={(e) => step(e, 1)}
        disabled={!stepping || current === pageCount - 1}
        aria-label="Next MCs"
        title={stepping ? range : undefined}
        className={navClass}
      >
        <Icon name="chevron-right" className="size-3.5" />
      </button>
    </div>
  );
}

function SharePreviewThumb({
  preview,
  height,
}: {
  preview: SharePreview;
  height: PreviewHeight;
}) {
  const src =
    preview.url === null
      ? null
      : preview.kind === "file"
        ? `${preview.url}?thumb=${THUMB_WIDTH[height]}`
        : preview.url;
  const caption = [preview.label ?? "Asset", preview.size]
    .filter((s): s is string => !!s)
    .join(" · ");
  return (
    <div
      className={clsx(
        "share-preview-strip__thumb flex shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200",
        THUMB_BOX[height],
        src ? "thumb-checker" : "share-preview-strip__thumb--empty bg-slate-50",
      )}
      title={caption}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={caption}
          loading="lazy"
          decoding="async"
          className="share-preview-strip__image block max-h-full max-w-full object-contain"
        />
      ) : (
        <span className="share-preview-strip__label truncate px-0.5 font-mono text-[9px] text-slate-400">
          {preview.label}
        </span>
      )}
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

// Body of the Refresh confirm dialog: per share, each creative that a newer
// version (_n2, _n3 …) replaces — old thumbnail → new thumbnail.
function RefreshPreview({ previews }: { previews: RefreshPreviewShare[] }) {
  const withSwaps = previews.filter((p) => p.replaced.length > 0);
  return (
    <div className="share-refresh-preview flex flex-col gap-3">
      <p>
        The public link will show the current content, text styles and custom CSS of its
        creatives. The link and the order stay.
      </p>
      {withSwaps.length === 0 ? (
        <p className="share-refresh-preview__none text-slate-500">
          No newer versions — nothing is swapped.
        </p>
      ) : (
        <div className="share-refresh-preview__list flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
          {withSwaps.map((p) => (
            <section key={p.share.id} className="share-refresh-preview__share flex flex-col gap-2">
              {previews.length > 1 ? (
                <h3 className="share-refresh-preview__share-title truncate text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {p.share.title ?? "(untitled)"}
                </h3>
              ) : null}
              <p className="share-refresh-preview__count">
                {p.replaced.length} creative{p.replaced.length === 1 ? "" : "s"} swapped for a
                newer version, in the same place, with comments:
              </p>
              {p.replaced.map((pair) => (
                <div
                  key={pair.from.id}
                  className="share-refresh-preview__pair flex items-start gap-2"
                >
                  <RefreshThumb item={pair.from} />
                  <Icon
                    name="chevron-right"
                    className="share-refresh-preview__arrow mt-12 size-4 shrink-0 text-slate-400"
                  />
                  <RefreshThumb item={pair.to} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function RefreshThumb({ item }: { item: RefreshPreviewItem }) {
  return (
    <figure className="share-refresh-preview__item flex w-[150px] min-w-0 flex-col gap-1">
      <div className="share-refresh-preview__thumb thumb-checker flex h-[110px] items-center justify-center overflow-hidden rounded-md border border-slate-200">
        {item.fileId && item.kind !== "other" ? (
          <img
            src={`/api/files/${item.fileId}/thumbnail?w=200`}
            alt={item.fileName ?? "creative"}
            className="share-refresh-preview__image block max-h-full max-w-full object-contain"
            decoding="async"
          />
        ) : (
          <Icon name="image" className="size-6 text-slate-300" />
        )}
      </div>
      <figcaption className="share-refresh-preview__name whitespace-normal break-all font-mono text-[10px] leading-snug text-slate-600">
        {item.fileName}
      </figcaption>
    </figure>
  );
}
