"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import clsx from "clsx";

type AuditRow = {
  id: number;
  clientId: number;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: string | null;
  after: string | null;
  createdAt: string;
};

type ListResponse = {
  rows: AuditRow[];
  hasMore: boolean;
  nextOffset: number | null;
};

const ENTITY_OPTIONS = [
  "audiences",
  "topics",
  "messages",
  "assets",
  "creatives",
  "text_formatting",
  "share_galleries",
  "uploaded_files",
  "users",
  "snapshots",
  "config",
];

const ACTION_OPTIONS = [
  "create",
  "update",
  "delete",
  "archive",
  "restore",
  "snapshot_restore",
  "bulk_create",
  "bulk_update",
  "bulk_delete",
  "bulk_archive",
  "bulk_restore",
];

export function ChangelogTab() {
  const [entity, setEntity] = useState<string>("");
  const [actions, setActions] = useState<Set<string>>(new Set());
  const [since, setSince] = useState<string>(""); // YYYY-MM-DD
  const [until, setUntil] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  const params = useMemo(() => {
    const u = new URLSearchParams();
    if (entity) u.set("entity", entity);
    if (actions.size > 0) u.set("actions", [...actions].join(","));
    if (since) u.set("since", since);
    if (until) u.set("until", until + "T23:59:59");
    if (userId) u.set("userId", userId);
    u.set("limit", String(PAGE_SIZE));
    u.set("offset", String(page * PAGE_SIZE));
    return u.toString();
  }, [entity, actions, since, until, userId, page]);

  const q = useQuery({
    queryKey: ["audit-log", params],
    queryFn: async (): Promise<ListResponse> => {
      const r = await fetch(`/api/audit-log?${params}`);
      if (!r.ok) throw new Error("audit-log fetch failed");
      return r.json();
    },
  });

  function toggleAction(a: string) {
    setActions((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
    setPage(0);
  }

  function clearFilters() {
    setEntity("");
    setActions(new Set());
    setSince("");
    setUntil("");
    setUserId("");
    setPage(0);
  }

  return (
    <div className="changelog-tab mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Changelog</h1>
        <p className="mt-1 text-xs text-slate-500">
          Every mutation against this client&apos;s data is recorded here.
          Restore via the Snapshots tab — there is no per-row undo by design.
        </p>
      </header>

      <section className="changelog-tab__filters rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <div className="flex flex-wrap items-end gap-3">
          <label className="form-field block">
            <div className="form-field__label mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Entity
            </div>
            <select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setPage(0);
              }}
              className="input-box rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
            >
              <option value="">all</option>
              {ENTITY_OPTIONS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field block">
            <div className="form-field__label mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              From
            </div>
            <input
              type="date"
              value={since}
              onChange={(e) => {
                setSince(e.target.value);
                setPage(0);
              }}
              className="input-box rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label className="form-field block">
            <div className="form-field__label mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              To
            </div>
            <input
              type="date"
              value={until}
              onChange={(e) => {
                setUntil(e.target.value);
                setPage(0);
              }}
              className="input-box rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label className="form-field block">
            <div className="form-field__label mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              User id
            </div>
            <input
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(0);
              }}
              placeholder="(any)"
              className="input-box w-32 rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={clearFilters}
            className="toolbar-btn ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>

        <div className="changelog-tab__action-pills mt-3 flex flex-wrap gap-1.5">
          {ACTION_OPTIONS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => toggleAction(a)}
              className={clsx(
                "tag-chip rounded border px-2 py-0.5 text-[10px] font-mono",
                actions.has(a)
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {a}
            </button>
          ))}
        </div>
      </section>

      <section className="changelog-tab__list">
        {q.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </p>
        ) : q.isError ? (
          <p className="error-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Failed to load.
          </p>
        ) : (q.data?.rows ?? []).length === 0 ? (
          <div className="empty-state rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No audit rows match the filters.
          </div>
        ) : (
          <ul className="space-y-1">
            {(q.data?.rows ?? []).map((row) => (
              <ChangelogRow key={row.id} row={row} />
            ))}
          </ul>
        )}

        {q.data ? (
          <div className="changelog-tab__paginator mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              page {page + 1} ({q.data.rows.length} rows)
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
                className="toolbar-btn rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!q.data.hasMore}
                className="toolbar-btn rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ChangelogRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const ts = row.createdAt.replace("T", " ").slice(0, 19);
  return (
    <li className="changelog-row rounded border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="changelog-row__head flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-slate-50"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-slate-400" />
        ) : (
          <ChevronRight className="size-3.5 text-slate-400" />
        )}
        <span className="changelog-row__ts w-36 shrink-0 font-mono text-[10px] text-slate-500">
          {ts}
        </span>
        <span
          className={clsx(
            "changelog-row__action w-28 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px] font-medium",
            actionColor(row.action),
          )}
        >
          {row.action}
        </span>
        <span className="changelog-row__entity w-32 shrink-0 truncate font-mono text-[10px] text-slate-700">
          {row.entityType}
          <span className="text-slate-400">/{row.entityId}</span>
        </span>
        <span className="changelog-row__user truncate text-[10px] text-slate-500">
          {row.userId ?? "(system)"}
        </span>
      </button>
      {open ? (
        <div className="changelog-row__body grid grid-cols-2 gap-3 border-t border-slate-100 p-3 text-[11px]">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              Before
            </div>
            <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-700">
              {row.before ? prettyJson(row.before) : "(none)"}
            </pre>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
              After
            </div>
            <pre className="max-h-72 overflow-auto rounded bg-slate-50 p-2 font-mono text-[10px] text-slate-700">
              {row.after ? prettyJson(row.after) : "(none)"}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function actionColor(action: string): string {
  if (action === "create" || action === "bulk_create")
    return "bg-emerald-100 text-emerald-800";
  if (action === "update" || action === "bulk_update")
    return "bg-blue-100 text-blue-800";
  if (action === "delete" || action === "bulk_delete")
    return "bg-rose-100 text-rose-800";
  if (action === "archive" || action === "bulk_archive")
    return "bg-amber-100 text-amber-800";
  if (action === "restore" || action === "bulk_restore")
    return "bg-emerald-100 text-emerald-800";
  if (action === "snapshot_restore") return "bg-purple-100 text-purple-800";
  return "bg-slate-100 text-slate-700";
}
