"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, EyeOff, Loader2, Plus, Check, X } from "lucide-react";
import clsx from "clsx";
import type { Channel } from "@/db/schema";

type ChannelsResponse = { channels: Channel[] };

// Settings › Channels — the authoritative nonDCO channel list (the columns of
// the nonDCO matrix). Channels used to be `audiences.channel != null` rows;
// they now live in their own table. nonDCO MCs are minted only via creative
// upload, so this list just governs which channels exist + their labels.
export function ChannelsTab() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<{ id: number; label: string } | null>(
    null,
  );

  const q = useQuery<ChannelsResponse>({
    queryKey: ["channels", "all"],
    queryFn: async () => {
      const r = await fetch("/api/channels?includeArchived=1", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json();
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["channels"] });
  };

  const addMut = useMutation({
    mutationFn: async () => {
      const c = code.trim().toUpperCase();
      const l = label.trim();
      const r = await fetch("/api/channels", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: `ch_${c.toLowerCase()}`, code: c, label: l }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      setCode("");
      setLabel("");
      invalidate();
    },
  });

  const patchMut = useMutation({
    mutationFn: async (args: {
      id: number;
      body: Record<string, unknown>;
    }) => {
      const r = await fetch(`/api/channels/${args.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });

  const archiveMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/channels/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: invalidate,
  });

  const all = q.data?.channels ?? [];
  const rows = showArchived ? all : all.filter((c) => c.archivedAt == null);
  const canAdd = code.trim().length > 0 && label.trim().length > 0;

  return (
    <div className="channels-tab max-w-2xl">
      <div className="channels-tab__header mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Channels</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            The nonDCO matrix columns. nonDCO MCs are created automatically when
            correctly-named creatives are uploaded to the Creative Library.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="channels-tab__add form-field mb-3 flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code (e.g. DISP)"
          className="input-box w-40 rounded border border-slate-300 px-2 py-1.5 text-sm uppercase"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Display)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd && !addMut.isPending) addMut.mutate();
          }}
          className="input-box flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={!canAdd || addMut.isPending}
          onClick={() => addMut.mutate()}
          className="toolbar-btn--primary inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {addMut.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Add
        </button>
      </div>

      {q.isLoading ? (
        <div className="empty-state p-4 text-sm text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No channels yet.
        </div>
      ) : (
        <ul className="channels-tab__list divide-y divide-slate-100 rounded border border-slate-200">
          {rows.map((c) => (
            <li
              key={c.id}
              className={clsx(
                "channels-tab__row flex items-center gap-3 px-3 py-2",
                c.archivedAt != null && "opacity-50",
              )}
            >
              <span className="status-badge inline-flex min-w-14 justify-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                {c.code}
              </span>
              {editing?.id === c.id ? (
                <input
                  autoFocus
                  value={editing.label}
                  onChange={(e) =>
                    setEditing({ id: c.id, label: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editing.label.trim())
                      patchMut.mutate({ id: c.id, body: { label: editing.label.trim() } });
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="input-box flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing({ id: c.id, label: c.label })}
                  className="channels-tab__label flex-1 text-left text-sm text-slate-800 hover:underline"
                  title="Rename"
                >
                  {c.label}
                </button>
              )}
              <span className="channels-tab__key text-[11px] text-slate-400">
                {c.key}
              </span>
              {editing?.id === c.id ? (
                <button
                  type="button"
                  onClick={() =>
                    patchMut.mutate({ id: c.id, body: { label: editing.label.trim() } })
                  }
                  disabled={!editing.label.trim() || patchMut.isPending}
                  className="toolbar-btn rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-50"
                  title="Save"
                >
                  <Check className="size-3.5" />
                </button>
              ) : null}
              {editing?.id === c.id ? (
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="toolbar-btn rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-50"
                  title="Cancel"
                >
                  <X className="size-3.5" />
                </button>
              ) : c.archivedAt != null ? (
                <button
                  type="button"
                  onClick={() => patchMut.mutate({ id: c.id, body: { restore: true } })}
                  className="toolbar-btn rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-50"
                  title="Restore"
                >
                  <ArchiveRestore className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => archiveMut.mutate(c.id)}
                  className="toolbar-btn rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-50"
                  title="Archive"
                >
                  <EyeOff className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
