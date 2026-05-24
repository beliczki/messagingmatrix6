"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  EyeOff,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Keyword } from "@/db/schema";
import {
  KEYWORD_FIELDS,
  KEYWORD_FORMS,
  type KeywordForm,
} from "@/lib/keywords-shared";

type KeywordsResponse = { keywords: Keyword[] };

// Field labels match the audience/topic editor labels for parity.
const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  product: "Product",
  strategy: "Strategy",
  buyingPlatform: "Buying platform",
  dataSource: "Data source",
  targetingType: "Targeting type",
  device: "Device",
  tag1: "Tag 1",
  tag2: "Tag 2",
  tag3: "Tag 3",
};

const FORM_LABELS: Record<KeywordForm, string> = {
  audiences: "Audiences",
  topics: "Topics",
};

type Selected = { form: KeywordForm; field: string };

export function KeywordsTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Selected>({
    form: "audiences",
    field: "status",
  });
  const [showArchived, setShowArchived] = useState(false);
  const [newValue, setNewValue] = useState("");

  const q = useQuery({
    queryKey: ["keywords"],
    queryFn: async (): Promise<Keyword[]> => {
      const r = await fetch("/api/keywords?includeArchived=1", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = (await r.json()) as KeywordsResponse;
      return data.keywords;
    },
  });

  const allRows = q.data ?? [];

  const rows = useMemo(() => {
    return allRows
      .filter((k) => k.form === selected.form && k.field === selected.field)
      .filter((k) => (showArchived ? true : k.archivedAt === null))
      .sort((a, b) => {
        if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
        return a.id - b.id;
      });
  }, [allRows, selected, showArchived]);

  // Per-section counts (live only) for the sidebar chip.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of allRows) {
      if (k.archivedAt !== null) continue;
      const key = `${k.form}|${k.field}`;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }, [allRows]);

  const createM = useMutation({
    mutationFn: async (value: string) => {
      const r = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          form: selected.form,
          field: selected.field,
          value,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `${r.status}`);
      }
    },
    onSuccess: () => {
      setNewValue("");
      qc.invalidateQueries({ queryKey: ["keywords"] });
    },
  });

  const updateM = useMutation({
    mutationFn: async (input: { id: number; value: string }) => {
      const r = await fetch(`/api/keywords/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ value: input.value }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `${r.status}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const archiveM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/keywords/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const restoreM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/keywords/${id}/restore`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }),
  });

  const reorderM = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await fetch("/api/keywords/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          form: selected.form,
          field: selected.field,
          ids,
        }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keywords"] }),
  });

  function move(index: number, dir: -1 | 1) {
    const liveIds = rows.filter((r) => r.archivedAt === null).map((r) => r.id);
    const i = liveIds.indexOf(rows[index].id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= liveIds.length) return;
    const next = [...liveIds];
    [next[i], next[j]] = [next[j], next[i]];
    reorderM.mutate(next);
  }

  function onAdd() {
    const v = newValue.trim();
    if (!v) return;
    createM.mutate(v);
  }

  return (
    <div className="keywords-tab flex h-full gap-6">
      {/* Left: form/field sidebar */}
      <aside className="keywords-tab__sidebar w-60 shrink-0 space-y-4">
        {KEYWORD_FORMS.map((form) => (
          <div key={form} className="keywords-tab__section">
            <div className="keywords-tab__section-label mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {FORM_LABELS[form]}
            </div>
            <ul className="keywords-tab__field-list space-y-0.5">
              {KEYWORD_FIELDS[form].map((field) => {
                const isActive =
                  selected.form === form && selected.field === field;
                const n = counts[`${form}|${field}`] ?? 0;
                return (
                  <li key={field}>
                    <button
                      type="button"
                      onClick={() => setSelected({ form, field })}
                      className={clsx(
                        "keywords-tab__field-btn flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition",
                        isActive
                          ? "keywords-tab__field-btn--active bg-brand-primary/10 text-brand-primary"
                          : "text-slate-700 hover:bg-slate-100",
                      )}
                    >
                      <span>{FIELD_LABELS[field] ?? field}</span>
                      <span className="keywords-tab__field-count text-[10px] text-slate-500">
                        {n}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </aside>

      {/* Right: value list for selected (form,field) */}
      <section className="keywords-tab__pane flex min-w-0 flex-1 flex-col">
        <header className="keywords-tab__pane-header mb-3 flex items-center justify-between gap-3">
          <h2 className="keywords-tab__pane-title text-base font-semibold text-slate-900">
            {FORM_LABELS[selected.form]} ·{" "}
            {FIELD_LABELS[selected.field] ?? selected.field}
          </h2>
          <label className="keywords-tab__archived-toggle flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </header>

        <form
          className="keywords-tab__add-row mb-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Add value…"
            className="keywords-tab__add-input flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newValue.trim() || createM.isPending}
            className="toolbar-btn toolbar-btn--primary inline-flex items-center gap-1 rounded-md bg-brand-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {createM.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Add
          </button>
        </form>
        {createM.error ? (
          <div className="keywords-tab__error mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {(createM.error as Error).message}
          </div>
        ) : null}

        {q.isLoading ? (
          <div className="keywords-tab__empty text-sm text-slate-500">
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="keywords-tab__empty rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            No values yet. The audience/topic editor will fall back to freeform
            input.
          </div>
        ) : (
          <ul className="keywords-tab__list divide-y divide-slate-200 rounded-md border border-slate-200">
            {rows.map((k, index) => {
              const archived = k.archivedAt !== null;
              return (
                <li
                  key={k.id}
                  className={clsx(
                    "keywords-tab__row flex items-center gap-2 px-3 py-1.5",
                    archived && "keywords-tab__row--archived bg-slate-50 opacity-60",
                  )}
                >
                  {/* Reorder up/down — only meaningful for live rows */}
                  <div className="keywords-tab__row-reorder flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={archived || index === 0}
                      title="Move up"
                      className="keywords-tab__row-up text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={archived || index === rows.length - 1}
                      title="Move down"
                      className="keywords-tab__row-down text-slate-400 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </div>

                  {/* Editable value */}
                  <InlineValue
                    value={k.value}
                    disabled={archived}
                    onCommit={(next) => {
                      if (next !== k.value) updateM.mutate({ id: k.id, value: next });
                    }}
                  />

                  {/* Archive / restore */}
                  {archived ? (
                    <button
                      type="button"
                      onClick={() => restoreM.mutate(k.id)}
                      title="Restore"
                      className="keywords-tab__row-restore text-slate-500 hover:text-emerald-600"
                    >
                      <ArchiveRestore className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => archiveM.mutate(k.id)}
                      title="Archive"
                      className="keywords-tab__row-archive text-slate-400 hover:text-rose-600"
                    >
                      <EyeOff className="size-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function InlineValue({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // Reset draft if the prop changes (e.g. after invalidation).
  if (!editing && draft !== value) setDraft(value);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        className={clsx(
          "keywords-tab__row-value flex-1 truncate text-left text-sm",
          disabled ? "cursor-default text-slate-500" : "cursor-text text-slate-900 hover:underline",
        )}
      >
        {value}
      </button>
    );
  }
  return (
    <div className="keywords-tab__row-edit flex flex-1 items-center gap-1">
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setEditing(false);
            onCommit(draft);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setDraft(value);
          }
        }}
        className="keywords-tab__row-edit-input flex-1 rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setEditing(false);
          setDraft(value);
        }}
        title="Cancel"
        className="keywords-tab__row-edit-cancel text-slate-400 hover:text-slate-700"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
