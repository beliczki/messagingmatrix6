"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";

type Client = {
  id: number;
  key: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ActiveClient = { key: string; name: string };

export function ClientsTab({ activeClient }: { activeClient: ActiveClient }) {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const q = useQuery({
    queryKey: ["clients"],
    queryFn: async (): Promise<Client[]> => {
      const r = await fetch("/api/clients");
      if (!r.ok) throw new Error("clients fetch failed");
      const data = (await r.json()) as { clients: Client[] };
      return data.clients;
    },
  });

  const patchM = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number;
      patch: Partial<{ name: string; status: string }>;
    }) => {
      const r = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("patch failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      setEditingId(null);
    },
  });

  function startEdit(c: Client) {
    setEditingId(c.id);
    setEditName(c.name);
  }

  function saveEdit(c: Client) {
    if (editName.trim().length === 0 || editName === c.name) {
      setEditingId(null);
      return;
    }
    patchM.mutate({ id: c.id, patch: { name: editName.trim() } });
  }

  function toggleArchive(c: Client) {
    patchM.mutate({
      id: c.id,
      patch: { status: c.status === "archived" ? "active" : "archived" },
    });
  }

  return (
    <div className="clients-tab max-w-4xl">
      <div className="clients-tab__banner mb-6 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <span className="status-dot status-dot--active" />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            This deploy is locked to
          </p>
          <p className="text-sm font-semibold text-slate-900">
            {activeClient.name}{" "}
            <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-slate-600">
              {activeClient.key}
            </span>
          </p>
        </div>
        <p className="text-xs text-slate-500">
          Switch by editing <code className="font-mono">ACTIVE_CLIENT_KEY</code>{" "}
          and redeploying.
        </p>
      </div>

      <header className="clients-tab__header mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">All clients</h2>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="toolbar-btn--primary rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white"
        >
          New client
        </button>
      </header>

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : q.isError ? (
        <p className="error-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load clients.
        </p>
      ) : (
        <table className="clients-tab__table w-full table-auto border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2 font-medium">Key</th>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Created</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((c) => {
              const isActive = c.key === activeClient.key;
              const isArchived = c.status === "archived";
              return (
                <tr
                  key={c.id}
                  className={clsx(
                    "clients-tab__row border-b border-slate-100",
                    isArchived && "clients-tab__row--archived opacity-60",
                  )}
                >
                  <td className="px-2 py-2 font-mono text-xs">
                    {c.key}
                    {isActive ? (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                        active
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    {editingId === c.id ? (
                      <input
                        autoFocus
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => saveEdit(c)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(c);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="input-box w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="text-left text-slate-900 hover:underline"
                      >
                        {c.name}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={clsx(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        isArchived
                          ? "bg-slate-200 text-slate-600"
                          : "bg-emerald-100 text-emerald-800",
                      )}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">
                    {c.createdAt.slice(0, 10)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleArchive(c)}
                        disabled={patchM.isPending}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {isArchived ? "Unarchive" : "Archive"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showNew ? (
        <NewClientModal
          existing={q.data ?? []}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["clients"] });
            setShowNew(false);
          }}
        />
      ) : null}

    </div>
  );
}

function NewClientModal({
  existing,
  onClose,
  onCreated,
}: {
  existing: Client[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [copyFromKey, setCopyFromKey] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const body: { key: string; name: string; copyFromKey?: string } = {
        key,
        name,
      };
      if (copyFromKey) body.copyFromKey = copyFromKey;
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      return data;
    },
    onSuccess: onCreated,
  });

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">New client</h3>
          <button
            type="button"
            onClick={onClose}
            className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Key
            </span>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
              placeholder="erste, telekom, demo, …"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-slate-500 focus:outline-none"
            />
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              Lowercase letter + a-z, 0-9, _ or -. Used as{" "}
              <code className="font-mono">ACTIVE_CLIENT_KEY</code> for the
              client&apos;s deploy. Cannot be changed later.
            </span>
          </label>

          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Display name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Erste, Telekom, Demo, …"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>

          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Copy config from (optional)
            </span>
            <select
              value={copyFromKey}
              onChange={(e) => setCopyFromKey(e.target.value)}
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">(none — seed defaults)</option>
              {existing.map((c) => (
                <option key={c.id} value={c.key}>
                  {c.name} ({c.key})
                </option>
              ))}
            </select>
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              Copies all <code className="font-mono">config</code> rows
              (lookAndFeel, structures, parsing rules) from another client.
            </span>
          </label>

          {m.isError ? (
            <p className="error-alert rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {(m.error as Error).message}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={m.isPending}
              className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {m.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
