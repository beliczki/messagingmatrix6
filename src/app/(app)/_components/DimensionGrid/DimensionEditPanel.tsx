"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Pencil, Copy, Trash2, Loader2 } from "lucide-react";
import { type Column } from "./columns";
import { type Versioned } from "./useRowAutosave";

type Mode = "bulk-set" | "duplicate" | "delete";

type RowResult = {
  id: number;
  ok: boolean;
  reason?: string;
  referencedBy?: number[];
};

type Props<T extends Versioned> = {
  selected: T[];
  columns: Column<T>[];
  productOptions: string[];
  baseUrl: string;
  queryKey: readonly unknown[];
  onClearSelection: () => void;
  collapsed: boolean;
};

const CONCURRENCY = 8;

export default function DimensionEditPanel<T extends Versioned>({
  selected,
  columns,
  productOptions,
  baseUrl,
  queryKey,
  onClearSelection,
  collapsed,
}: Props<T>) {
  const qc = useQueryClient();
  const editable = columns.filter(
    (c) => !(c.type.kind === "text" && c.type.readOnly),
  );
  const [mode, setMode] = useState<Mode>("bulk-set");
  const [field, setField] = useState<string>(editable[0]?.key ?? "");
  const [value, setValue] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  useEffect(() => {
    setResults(null);
  }, [mode, field, value, selected.length]);

  if (collapsed) {
    return (
      <button
        type="button"
        title={`Edit ${selected.length} selected`}
        aria-label={`Edit ${selected.length} selected`}
        className="dimension-edit-panel__collapsed-icon relative rounded p-1.5 text-slate-500 hover:bg-slate-100"
      >
        <Pencil className="size-5" />
        {selected.length > 0 ? (
          <span className="dimension-edit-panel__collapsed-badge absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-900 px-1 text-[9px] font-medium text-white">
            {selected.length}
          </span>
        ) : null}
      </button>
    );
  }

  if (selected.length === 0) return null;

  const col = editable.find((c) => c.key === field) ?? editable[0];

  async function runBatch(action: (row: T) => Promise<RowResult>) {
    setRunning(true);
    setResults(null);
    const queue = [...selected];
    const out: RowResult[] = [];
    async function worker() {
      while (queue.length > 0) {
        const row = queue.shift();
        if (!row) break;
        out.push(await action(row));
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () =>
        worker(),
      ),
    );
    setResults(out);
    setRunning(false);
    await qc.invalidateQueries({ queryKey });
  }

  function coerceValue(): unknown {
    if (!col) return value;
    if (col.type.kind === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return value === "" ? null : value;
  }

  async function applyBulkSet() {
    if (!col) return;
    const colKey = col.key;
    const payloadValue = coerceValue();
    await runBatch(async (row) => {
      try {
        const r = await fetch(`${baseUrl}/${row.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(row.version),
          },
          body: JSON.stringify({ [colKey]: payloadValue }),
        });
        if (r.ok) return { id: row.id, ok: true };
        if (r.status === 409) return { id: row.id, ok: false, reason: "conflict" };
        return { id: row.id, ok: false, reason: `${r.status}` };
      } catch (e) {
        return { id: row.id, ok: false, reason: (e as Error).message };
      }
    });
  }

  async function applyDuplicate() {
    await runBatch(async (row) => {
      try {
        const r = await fetch(`${baseUrl}/${row.id}/duplicate`, {
          method: "POST",
          credentials: "include",
        });
        if (r.ok) return { id: row.id, ok: true };
        return { id: row.id, ok: false, reason: `${r.status}` };
      } catch (e) {
        return { id: row.id, ok: false, reason: (e as Error).message };
      }
    });
  }

  async function applyDelete() {
    await runBatch(async (row) => {
      try {
        const r = await fetch(`${baseUrl}/${row.id}/hard-delete`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(row.version),
          },
          body: JSON.stringify({}),
        });
        if (r.ok) return { id: row.id, ok: true };
        if (r.status === 409) {
          const body = (await r.json().catch(() => null)) as {
            error?: string;
            referencedBy?: number[];
          } | null;
          if (body?.error === "in_use") {
            return {
              id: row.id,
              ok: false,
              reason: `in use (${body.referencedBy?.length ?? 0} MC)`,
              referencedBy: body.referencedBy,
            };
          }
          return { id: row.id, ok: false, reason: "conflict" };
        }
        return { id: row.id, ok: false, reason: `${r.status}` };
      } catch (e) {
        return { id: row.id, ok: false, reason: (e as Error).message };
      }
    });
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const failCount = results ? results.length - okCount : 0;

  return (
    <div className="dimension-edit-panel rounded-md border border-slate-200 bg-white p-3">
      <div className="dimension-edit-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Edit
      </div>

      <div className="dimension-edit-panel__count mt-2 text-[11px] font-semibold text-slate-700">
        {selected.length} selected
      </div>

      <div
        role="tablist"
        className="dimension-edit-panel__actions mt-2 grid grid-cols-3 gap-1"
      >
        <ActionTab
          active={mode === "bulk-set"}
          onClick={() => setMode("bulk-set")}
          label="Set"
          icon={<Pencil className="size-3" />}
          modifier="bulk-set"
        />
        <ActionTab
          active={mode === "duplicate"}
          onClick={() => setMode("duplicate")}
          label="Duplicate"
          icon={<Copy className="size-3" />}
          modifier="duplicate"
        />
        <ActionTab
          active={mode === "delete"}
          onClick={() => setMode("delete")}
          label="Delete"
          icon={<Trash2 className="size-3" />}
          modifier="delete"
        />
      </div>

      {mode === "bulk-set" && col ? (
        <div className="dimension-edit-panel__form mt-3 flex flex-col gap-2">
          <label className="dimension-edit-panel__label text-[10px] uppercase tracking-wider text-slate-500">
            Field
          </label>
          <select
            value={field}
            onChange={(e) => {
              setField(e.target.value);
              setValue("");
            }}
            className="custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
          >
            {editable.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="dimension-edit-panel__label text-[10px] uppercase tracking-wider text-slate-500">
            Value
          </label>
          <BulkValueInput
            col={col}
            productOptions={productOptions}
            value={value}
            onChange={setValue}
          />
          <button
            type="button"
            onClick={applyBulkSet}
            disabled={running}
            className="dimension-edit-panel__apply toolbar-btn--primary mt-1 inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : null}
            Apply ({selected.length})
          </button>
        </div>
      ) : null}

      {mode === "duplicate" ? (
        <div className="dimension-edit-panel__form mt-3 flex flex-col gap-2">
          <p className="dimension-edit-panel__hint text-[11px] text-slate-500">
            Adds <code className="rounded bg-slate-100 px-1">(n)</code> to name,{" "}
            <code className="rounded bg-slate-100 px-1">_n</code> to key.
          </p>
          <button
            type="button"
            onClick={applyDuplicate}
            disabled={running}
            className="dimension-edit-panel__apply toolbar-btn--primary inline-flex items-center justify-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : null}
            Duplicate ({selected.length})
          </button>
        </div>
      ) : null}

      {mode === "delete" ? (
        <div className="dimension-edit-panel__form mt-3 flex flex-col gap-2">
          <p className="dimension-edit-panel__hint text-[11px] text-slate-500">
            Hard delete. Refuses any row that still has messages.
          </p>
          <button
            type="button"
            onClick={applyDelete}
            disabled={running}
            className="dimension-edit-panel__apply dimension-edit-panel__apply--danger inline-flex items-center justify-center gap-1 rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : null}
            Delete ({selected.length})
          </button>
        </div>
      ) : null}

      {results ? (
        <div
          className={clsx(
            "dimension-edit-panel__results mt-2 text-[11px]",
            failCount > 0 ? "text-amber-700" : "text-emerald-700",
          )}
        >
          <div>
            {okCount} ok{failCount > 0 ? `, ${failCount} failed` : ""}
          </div>
          {failCount > 0 ? (
            <ul className="dimension-edit-panel__results-list mt-1 max-h-24 list-inside list-disc overflow-y-auto text-slate-600">
              {results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.id} className="truncate">
                    #{r.id}: {r.reason}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onClearSelection}
        className="dimension-edit-panel__clear mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
      >
        Clear selection
      </button>
    </div>
  );
}

function ActionTab({
  active,
  onClick,
  label,
  icon,
  modifier,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  modifier: "bulk-set" | "duplicate" | "delete";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx(
        "dimension-edit-panel__action-btn inline-flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px]",
        `dimension-edit-panel__action-btn--${modifier}`,
        active
          ? "dimension-edit-panel__action-btn--active bg-slate-900 text-white"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function BulkValueInput<T extends Versioned>({
  col,
  productOptions,
  value,
  onChange,
}: {
  col: Column<T>;
  productOptions: string[];
  value: string;
  onChange: (next: string) => void;
}) {
  if (col.type.kind === "select") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      >
        {col.type.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === "" ? "— none —" : opt}
          </option>
        ))}
      </select>
    );
  }
  if (col.type.kind === "select-dynamic") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      >
        <option value="">— none —</option>
        {productOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (col.type.kind === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="(empty to clear)"
      className="rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
    />
  );
}
