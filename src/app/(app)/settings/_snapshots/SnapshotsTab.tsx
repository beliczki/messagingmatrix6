"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, History, Loader2, Trash2 } from "lucide-react";

type SnapshotMeta = {
  id: number;
  label: string;
  createdBy: string | null;
  createdAt: string;
  counts: Record<string, number>;
};

const COUNT_KEYS = [
  ["audiences", "Aud"],
  ["topics", "Top"],
  ["messages", "MC"],
  ["assets", "Assets"],
  ["creatives", "Creatives"],
  ["textFormatting", "Format"],
  ["reporting", "Reporting"],
  ["shareGalleries", "Shares"],
  ["uploadedFiles", "Files"],
  ["users", "Users"],
] as const;

export function SnapshotsTab() {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<SnapshotMeta | null>(null);

  const q = useQuery({
    queryKey: ["snapshots"],
    queryFn: async (): Promise<SnapshotMeta[]> => {
      const r = await fetch("/api/snapshots");
      if (!r.ok) throw new Error("snapshots fetch failed");
      const data = (await r.json()) as { snapshots: SnapshotMeta[] };
      return data.snapshots;
    },
  });

  const createM = useMutation({
    mutationFn: async (newLabel: string) => {
      const r = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "create failed");
      }
    },
    onSuccess: () => {
      setLabel("");
      qc.invalidateQueries({ queryKey: ["snapshots"] });
    },
  });

  const deleteM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("delete failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  const restoreM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/snapshots/${id}/restore`, {
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
      // Restore touches every list — invalidate everything.
      qc.invalidateQueries();
      setRestoreTarget(null);
    },
  });

  return (
    <div className="snapshots-tab mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Snapshots</h1>
        <p className="mt-1 text-xs text-slate-500">
          Point-in-time copy of all audiences, topics, messages, assets,
          creatives, text-formatting rules, reporting, share galleries, files
          and users for this client. Restore wipes the live data and re-inserts
          from the snapshot in a single transaction. Config (lookAndFeel,
          patterns) and audit history are not touched.
        </p>
      </header>

      <section className="snapshots-tab__create rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Create snapshot
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = label.trim();
            if (!trimmed) return;
            createM.mutate(trimmed);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='e.g. "before importing Q2 batch"'
            className="input-box flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={createM.isPending || !label.trim()}
            className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded bg-brand-button px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {createM.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Camera className="size-3.5" />
            )}
            Snapshot
          </button>
        </form>
        {createM.isError ? (
          <p className="mt-2 text-xs text-red-600">
            {(createM.error as Error).message}
          </p>
        ) : null}
      </section>

      <section className="snapshots-tab__list">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Saved snapshots
        </h2>
        {q.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (q.data ?? []).length === 0 ? (
          <div className="empty-state rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No snapshots yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {(q.data ?? []).map((s) => {
              const totalRows = COUNT_KEYS.reduce(
                (sum, [k]) => sum + (s.counts[k] ?? 0),
                0,
              );
              return (
                <li
                  key={s.id}
                  className="snapshots-tab__row flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.createdAt.replace("T", " ").slice(0, 19)} · {totalRows} rows
                      {s.createdBy ? ` · by ${s.createdBy}` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                      {COUNT_KEYS.map(([k, label]) =>
                        s.counts[k] ? (
                          <span
                            key={k}
                            className="tag-chip rounded bg-slate-100 px-1.5 py-0.5 font-mono"
                          >
                            {label}: {s.counts[k]}
                          </span>
                        ) : null,
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRestoreTarget(s)}
                    className="toolbar-btn rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  >
                    <History className="mr-1 inline size-3.5" />
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete snapshot "${s.label}"?`)) {
                        deleteM.mutate(s.id);
                      }
                    }}
                    disabled={deleteM.isPending}
                    title="Delete snapshot"
                    className="rounded border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {restoreTarget ? (
        <RestoreConfirmModal
          snapshot={restoreTarget}
          onCancel={() => setRestoreTarget(null)}
          onConfirm={() => restoreM.mutate(restoreTarget.id)}
          pending={restoreM.isPending}
          error={
            restoreM.isError ? (restoreM.error as Error).message : null
          }
        />
      ) : null}
    </div>
  );
}

function RestoreConfirmModal({
  snapshot,
  onCancel,
  onConfirm,
  pending,
  error,
}: {
  snapshot: SnapshotMeta;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  error: string | null;
}) {
  const totalRows = COUNT_KEYS.reduce(
    (sum, [k]) => sum + (snapshot.counts[k] ?? 0),
    0,
  );
  return (
    <div className="modal modal--restore-snapshot fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="modal__panel w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900">
          Restore snapshot?
        </h2>
        <p className="mt-2 text-sm text-slate-700">
          This will <strong>wipe</strong> all current audiences, topics,
          messages, assets, creatives, text-formatting rules, reporting, share
          galleries, files and users for this client, then re-insert{" "}
          {totalRows} rows from snapshot{" "}
          <strong>"{snapshot.label}"</strong> ({snapshot.createdAt.slice(0, 19)}).
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Both archived and live rows are replaced. Config (look-and-feel,
          patterns) and audit history are NOT affected.
        </p>
        {error ? (
          <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="toolbar-btn rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Restore
          </button>
        </div>
      </div>
    </div>
  );
}
