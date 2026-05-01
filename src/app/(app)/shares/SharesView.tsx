"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Trash2 } from "lucide-react";

type Share = {
  id: string;
  title: string | null;
  description: string | null;
  createdBy: string | null;
  createdAt: string;
  messageCount: number;
};

type Message = {
  id: number;
  number: number;
  variant: string;
  audience: string;
  topic: string;
  status: string | null;
  headline: string | null;
};

export function SharesView() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);

  const sharesQ = useQuery({
    queryKey: ["share-galleries"],
    queryFn: async (): Promise<Share[]> => {
      const r = await fetch("/api/share-galleries");
      if (!r.ok) throw new Error("shares fetch failed");
      const data = (await r.json()) as { shares: Share[] };
      return data.shares;
    },
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/share-galleries/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "delete failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["share-galleries"] });
    },
  });

  function confirmDelete(s: Share) {
    if (
      !window.confirm(
        `Delete share "${s.title ?? "untitled"}"? The public link will stop working.`,
      )
    ) {
      return;
    }
    deleteM.mutate(s.id);
  }

  function copyLink(id: string) {
    const url = `${window.location.origin}/share/${id}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <>
      <header className="shares__header toolbar flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <h1 className="text-lg font-semibold text-slate-900">Shares</h1>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="toolbar-btn--primary rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white"
        >
          New share
        </button>
      </header>

      <div className="shares__content flex-1 overflow-auto p-6">
        <div className="shares__list-wrap mx-auto max-w-4xl">
          {sharesQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : sharesQ.isError ? (
            <p className="error-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Failed to load shares.
            </p>
          ) : (sharesQ.data ?? []).length === 0 ? (
            <div className="empty-state mx-auto max-w-md rounded-lg border border-dashed border-slate-300 p-8 text-center">
              <p className="text-sm text-slate-500">
                No shares yet. Click <strong>New share</strong> to create the
                first one.
              </p>
            </div>
          ) : (
            <ul className="shares__list space-y-3">
              {(sharesQ.data ?? []).map((s) => (
                <li
                  key={s.id}
                  className="shares__row flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {s.title ?? (
                        <span className="italic text-slate-400">untitled</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {s.messageCount} message
                      {s.messageCount === 1 ? "" : "s"} · created{" "}
                      {s.createdAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 truncate font-mono text-xs text-slate-400">
                      /share/{s.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyLink(s.id)}
                    title="Copy public link"
                    className="rounded border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                  >
                    <Copy className="size-4" />
                  </button>
                  <a
                    href={`/share/${s.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open public page"
                    className="rounded border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                  <button
                    type="button"
                    onClick={() => confirmDelete(s)}
                    disabled={deleteM.isPending}
                    title="Delete share"
                    className="rounded border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showNew ? (
        <NewShareModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["share-galleries"] });
            setShowNew(false);
          }}
        />
      ) : null}
    </>
  );
}

function NewShareModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const messagesQ = useQuery({
    queryKey: ["messages", "for-share"],
    queryFn: async (): Promise<Message[]> => {
      const r = await fetch("/api/messages");
      if (!r.ok) throw new Error("messages fetch failed");
      const data = (await r.json()) as { messages: Message[] };
      return data.messages;
    },
  });

  const sorted = useMemo(() => {
    return (messagesQ.data ?? [])
      .slice()
      .sort((a, b) => a.number - b.number || a.variant.localeCompare(b.variant));
  }, [messagesQ.data]);

  const m = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/share-galleries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || null,
          description: description.trim() || null,
          mcIds: Array.from(selected),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      return data;
    },
    onSuccess: onCreated,
  });

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }
  function selectAll() {
    setSelected(new Set(sorted.map((s) => s.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">New share</h3>
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
          className="flex flex-1 flex-col gap-3 overflow-hidden"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Title (optional)
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q2 banner approvals"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>

          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Description (optional)
            </span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short note for the recipient"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>

          <div className="form-field flex min-h-0 flex-1 flex-col">
            <div className="form-field__head mb-1 flex items-center justify-between">
              <span className="form-field__label text-sm font-medium text-slate-700">
                Messages ({selected.size} selected)
              </span>
              <div className="form-field__actions text-xs">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-slate-600 hover:underline"
                >
                  All
                </button>
                <span className="mx-1 text-slate-300">·</span>
                <button
                  type="button"
                  onClick={selectNone}
                  className="text-slate-600 hover:underline"
                >
                  None
                </button>
              </div>
            </div>
            <div className="form-field__list min-h-0 flex-1 overflow-auto rounded-md border border-slate-200">
              {messagesQ.isLoading ? (
                <p className="p-3 text-sm text-slate-500">Loading…</p>
              ) : sorted.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">
                  No messages in this client yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {sorted.map((msg) => (
                    <li
                      key={msg.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(msg.id)}
                        onChange={() => toggle(msg.id)}
                        className="size-4 shrink-0"
                      />
                      <span className="font-mono text-xs font-semibold text-slate-700">
                        MC{msg.number}
                        {msg.variant}
                      </span>
                      <span className="text-xs text-slate-500">
                        {msg.audience} / {msg.topic}
                      </span>
                      <span className="ml-auto truncate text-xs text-slate-600">
                        {msg.headline ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

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
              disabled={m.isPending || selected.size === 0}
              className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {m.isPending
                ? "Creating…"
                : `Create share (${selected.size})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
