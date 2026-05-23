"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, RotateCcw, X } from "lucide-react";
import clsx from "clsx";
import ModalBackdrop from "./ModalBackdrop";

// Revision history for a single entity, rendered as a right-side drawer.
// Reads the audit-log `before`/`after` snapshots; "Restore" re-applies a past
// snapshot via the entity's normal versioned PATCH (so a concurrent edit just
// routes into the standard 409 conflict path).

export type HistoryEntity = "topics" | "audiences" | "messages";

type AuditRow = {
  id: number;
  userId: string | null;
  action: string;
  before: string | null;
  after: string | null;
  createdAt: string;
};

type Props = {
  entity: HistoryEntity;
  entityId: number;
  /** Human label for the drawer header, e.g. "MC3a" or a topic name. */
  label: string;
  onClose: () => void;
  /** Called after a successful restore, before the drawer closes. */
  onRestored?: () => void;
};

// Bookkeeping fields that change on every write — noise in a field diff.
const HIDDEN_DIFF_KEYS = new Set([
  "id",
  "clientId",
  "version",
  "createdAt",
  "updatedAt",
]);

const ACTION_LABEL: Record<string, string> = {
  create: "Created",
  update: "Edited",
  archive: "Archived",
  restore: "Restored",
  delete: "Deleted",
  snapshot_restore: "Snapshot restore",
  bulk_update: "Bulk edit",
  bulk_create: "Bulk create",
  bulk_archive: "Bulk archive",
  bulk_restore: "Bulk restore",
  bulk_delete: "Bulk delete",
  bulk_move: "Bulk move",
  bulk_copy: "Bulk copy",
};

function formatTime(iso: string): string {
  // SQLite CURRENT_TIMESTAMP is UTC with no zone marker — pin it before parse.
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleString();
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function diffFields(
  before: string | null,
  after: string | null,
): { key: string; before: unknown; after: unknown }[] {
  const a = (after ? JSON.parse(after) : {}) as Record<string, unknown>;
  const b = (before ? JSON.parse(before) : {}) as Record<string, unknown>;
  const out: { key: string; before: unknown; after: unknown }[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (HIDDEN_DIFF_KEYS.has(key)) continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      out.push({ key, before: b[key], after: a[key] });
    }
  }
  return out;
}

export default function EntityHistoryDrawer({
  entity,
  entityId,
  label,
  onClose,
  onRestored,
}: Props) {
  const qc = useQueryClient();
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Key starts with `entity` so the SSE live-sync invalidation (keyed by the
  // entity type) refreshes the drawer too when a peer write lands.
  const historyQ = useQuery({
    queryKey: [entity, "history", entityId],
    queryFn: async () => {
      const r = await fetch(`/api/${entity}/${entityId}/history`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("history");
      return (await r.json()) as { history: AuditRow[] };
    },
  });

  const history = historyQ.data?.history ?? [];
  // The newest entry's `after` is the live state — it carries the version
  // the restore PATCH must send for optimistic-concurrency.
  const currentVersion: number | null = (() => {
    const head = history[0];
    if (!head?.after) return null;
    const v = (JSON.parse(head.after) as { version?: unknown }).version;
    return typeof v === "number" ? v : null;
  })();

  async function restore(entry: AuditRow) {
    if (!entry.after || currentVersion === null) return;
    setRestoreError(null);
    setRestoringId(entry.id);
    const r = await fetch(`/api/${entity}/${entityId}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(currentVersion),
      },
      body: entry.after,
    });
    setRestoringId(null);
    if (r.status === 409) {
      setRestoreError(
        "This item changed since you opened history — refreshed, try again.",
      );
      qc.invalidateQueries({ queryKey: [entity] });
      return;
    }
    if (!r.ok) {
      setRestoreError((await r.text()) || r.statusText);
      return;
    }
    qc.invalidateQueries({ queryKey: [entity] });
    onRestored?.();
    onClose();
  }

  return (
    <ModalBackdrop onClose={onClose} className="z-[60] justify-end">
      <div className="entity-history modal flex h-full w-[460px] max-w-[92vw] flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl">
        <header className="entity-history__header modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <History className="entity-history__icon size-4 text-slate-500" />
          <span className="entity-history__title text-sm font-semibold text-slate-900">
            History
          </span>
          <span className="entity-history__label truncate text-xs text-slate-500">
            {label}
          </span>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="modal__close ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-5" />
          </button>
        </header>

        {restoreError ? (
          <div className="entity-history__error shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">
            {restoreError}
          </div>
        ) : null}

        <div className="entity-history__body flex-1 overflow-y-auto px-4 py-3">
          {historyQ.isLoading ? (
            <p className="entity-history__loading text-xs text-slate-500">
              Loading…
            </p>
          ) : historyQ.isError ? (
            <p className="entity-history__load-error text-xs text-rose-600">
              Couldn&apos;t load history.
            </p>
          ) : history.length === 0 ? (
            <p className="entity-history__empty empty-state text-xs text-slate-500">
              No history recorded yet.
            </p>
          ) : (
            <ol className="entity-history__list flex flex-col gap-3">
              {history.map((entry, idx) => {
                const fields = diffFields(entry.before, entry.after);
                const isCurrent = idx === 0;
                return (
                  <li
                    key={entry.id}
                    className={clsx(
                      "entity-history__entry rounded-md border border-slate-200 p-3",
                      isCurrent && "entity-history__entry--current bg-slate-50",
                    )}
                  >
                    <div className="entity-history__entry-head flex items-center gap-2">
                      <span className="entity-history__action text-xs font-medium text-slate-900">
                        {ACTION_LABEL[entry.action] ?? entry.action}
                      </span>
                      {isCurrent ? (
                        <span className="status-badge entity-history__current-badge rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                          Current
                        </span>
                      ) : null}
                      <span className="entity-history__time ml-auto text-[10px] tabular-nums text-slate-400">
                        {formatTime(entry.createdAt)}
                      </span>
                    </div>
                    <div className="entity-history__meta mt-0.5 text-[10px] text-slate-500">
                      by {entry.userId ?? "system"}
                    </div>

                    {fields.length > 0 ? (
                      <ul className="entity-history__diff mt-2 flex flex-col gap-1">
                        {fields.map((f) => (
                          <li
                            key={f.key}
                            className="entity-history__diff-row text-[11px]"
                          >
                            <span className="entity-history__diff-key font-medium text-slate-600">
                              {f.key}
                            </span>
                            <span className="entity-history__diff-old ml-1 text-rose-600 line-through">
                              {formatValue(f.before)}
                            </span>
                            <span className="entity-history__diff-arrow mx-1 text-slate-400">
                              →
                            </span>
                            <span className="entity-history__diff-new text-emerald-700">
                              {formatValue(f.after)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="entity-history__diff--empty mt-1 text-[11px] text-slate-400">
                        No field changes recorded.
                      </p>
                    )}

                    {!isCurrent && entry.after ? (
                      <button
                        onClick={() => restore(entry)}
                        disabled={restoringId !== null || currentVersion === null}
                        className="entity-history__restore toolbar-btn mt-2 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RotateCcw className="size-3" />
                        {restoringId === entry.id
                          ? "Restoring…"
                          : "Restore this version"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
}
