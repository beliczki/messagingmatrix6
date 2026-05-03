"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { type Column } from "./columns";
import { type Versioned } from "./useRowAutosave";

type Props<T extends Versioned> = {
  selected: T[];
  columns: Column<T>[];
  productOptions: string[];
  baseUrl: string;
  queryKey: readonly unknown[];
  onClearSelection: () => void;
};

type RowResult = { id: number; ok: boolean; reason?: string };

const CONCURRENCY = 8;

export default function BulkEditPanel<T extends Versioned>({
  selected,
  columns,
  productOptions,
  baseUrl,
  queryKey,
  onClearSelection,
}: Props<T>) {
  const qc = useQueryClient();
  const editable = columns.filter(
    (c) => !(c.type.kind === "text" && c.type.readOnly),
  );
  const [field, setField] = useState<string>(editable[0]?.key ?? "");
  const [value, setValue] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  useEffect(() => {
    setResults(null);
  }, [field, value, selected.length]);

  if (selected.length === 0) return null;

  const col = editable.find((c) => c.key === field);
  if (!col) return null;

  function renderValueInput() {
    if (!col) return null;
    if (col.type.kind === "select") {
      return (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="bulk-edit-panel__value custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
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
          onChange={(e) => setValue(e.target.value)}
          className="bulk-edit-panel__value custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
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
          onChange={(e) => setValue(e.target.value)}
          className="bulk-edit-panel__value w-32 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
        />
      );
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="(empty to clear)"
        className="bulk-edit-panel__value w-64 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
      />
    );
  }

  function coerceValue(): unknown {
    if (!col) return value;
    if (col.type.kind === "number") {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return value === "" ? null : value;
  }

  async function applyBulk() {
    if (!col) return;
    const colKey = col.key;
    setRunning(true);
    setResults(null);
    const queue = [...selected];
    const out: RowResult[] = [];
    const payloadValue = coerceValue();

    async function worker() {
      while (queue.length > 0) {
        const row = queue.shift();
        if (!row) break;
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
          if (r.ok) {
            out.push({ id: row.id, ok: true });
          } else if (r.status === 409) {
            out.push({ id: row.id, ok: false, reason: "conflict" });
          } else {
            out.push({ id: row.id, ok: false, reason: `${r.status}` });
          }
        } catch (e) {
          out.push({ id: row.id, ok: false, reason: (e as Error).message });
        }
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

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const failCount = results ? results.length - okCount : 0;

  return (
    <div className="bulk-edit-panel toolbar fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-lg">
      <span className="bulk-edit-panel__count rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
        {selected.length} selected
      </span>

      <span className="bulk-edit-panel__label text-xs text-slate-500">
        Set
      </span>
      <select
        value={field}
        onChange={(e) => {
          setField(e.target.value);
          setValue("");
        }}
        className="bulk-edit-panel__field custom-dropdown rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none"
      >
        {editable.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>

      <span className="bulk-edit-panel__label text-xs text-slate-500">to</span>
      {renderValueInput()}

      <button
        type="button"
        onClick={applyBulk}
        disabled={running}
        className="bulk-edit-panel__apply toolbar-btn--primary flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {running ? <Loader2 className="size-3 animate-spin" /> : null}
        Apply to {selected.length}
      </button>

      {results ? (
        <span
          className={clsx(
            "bulk-edit-panel__results text-xs",
            failCount > 0 ? "text-amber-700" : "text-emerald-700",
          )}
          title={
            failCount > 0
              ? results
                  .filter((r) => !r.ok)
                  .map((r) => `#${r.id}: ${r.reason}`)
                  .join("\n")
              : undefined
          }
        >
          {okCount} ok{failCount > 0 ? `, ${failCount} failed` : ""}
        </span>
      ) : null}

      <button
        type="button"
        onClick={onClearSelection}
        aria-label="Clear selection"
        className="bulk-edit-panel__close rounded p-1 text-slate-500 hover:bg-slate-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
