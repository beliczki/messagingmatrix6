"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type ConfigRow = { key: string; value: unknown };

const STORAGE_FIELDS: Array<{
  key: string;
  label: string;
  hint: string;
  placeholder?: string;
}> = [
  {
    key: "googleDriveFolderId",
    label: "Google Drive folder ID",
    hint: "Folder where new creatives/assets are picked up by the ingest pipeline (Phase 11).",
    placeholder: "1aBcD…",
  },
  {
    key: "spreadsheetExportTargetId",
    label: "Google Sheets export target ID",
    hint: "Sheet that receives the XLSX/Sheets export from the matrix.",
    placeholder: "1xYzW…",
  },
  {
    key: "adformApiToken",
    label: "AdForm API token",
    hint: "Bearer token for the AdForm sync (Phase 6c). Stored as-is in the config table; treat the deploy as trusted.",
    placeholder: "(paste token)",
  },
];

type Draft = Record<string, string>;

function rowsToDraft(rows: ConfigRow[]): Draft {
  const d: Draft = {};
  for (const f of STORAGE_FIELDS) d[f.key] = "";
  for (const r of rows) {
    if (typeof r.value === "string") {
      d[r.key] = r.value;
    }
  }
  return d;
}

export function StorageTab() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["config", "storage"],
    queryFn: async (): Promise<Draft> => {
      const r = await fetch("/api/config?category=storage");
      if (!r.ok) throw new Error("config fetch failed");
      const data = (await r.json()) as { rows: ConfigRow[] };
      return rowsToDraft(data.rows);
    },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data, draft]);

  const m = useMutation({
    mutationFn: async (d: Draft) => {
      const original = q.data ?? {};
      for (const f of STORAGE_FIELDS) {
        const v = d[f.key] ?? "";
        if (v === (original[f.key] ?? "")) continue;
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: f.key, value: v, category: "storage" }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(`save failed for ${f.key}: ${body.error ?? r.status}`);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config", "storage"] });
    },
  });

  if (!draft) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="storage-tab max-w-2xl pb-24">
      <header className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">Storage</h2>
        <p className="mt-1 text-sm text-slate-500">
          External integrations scoped to this client. Tokens are stored
          plaintext in the <code className="font-mono">config</code> table.
        </p>
      </header>

      <section className="storage-tab__section rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-4">
          {STORAGE_FIELDS.map((f) => (
            <label key={f.key} className="form-field block">
              <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
                {f.label}
              </span>
              <input
                type="text"
                value={draft[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  setDraft({ ...draft, [f.key]: e.target.value })
                }
                className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
              />
              <span className="form-field__hint mt-1 block text-xs text-slate-500">
                {f.hint}
              </span>
            </label>
          ))}
        </div>
      </section>

      <div className="storage-tab__actions sticky bottom-0 -mx-6 mt-6 flex items-center gap-3 border-t border-slate-200 bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => m.mutate(draft)}
          disabled={m.isPending}
          className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {m.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => q.data && setDraft(q.data)}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Revert
        </button>
        {m.isError ? (
          <span className="text-sm text-rose-600">
            {(m.error as Error).message}
          </span>
        ) : null}
        {m.isSuccess && !m.isPending ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
      </div>
    </div>
  );
}
