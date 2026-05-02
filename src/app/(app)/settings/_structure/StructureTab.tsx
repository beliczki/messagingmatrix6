"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_STRUCTURES, DEFAULT_CREATIVE_PARSING_RULES } from "@/db/defaults";
import { SettingsHeaderActions } from "../SettingsView";

type ConfigRow = { key: string; value: unknown };

const STRUCTURE_KEYS = [
  ["audienceStructure", "Audience structure"],
  ["topicStructure", "Topic structure"],
  ["messagesStructure", "Messages structure"],
  ["creativeStructure", "Creative structure"],
  ["feedStructure", "Feed structure"],
] as const;

type Draft = {
  audienceStructure: string;
  topicStructure: string;
  messagesStructure: string;
  creativeStructure: string;
  feedStructure: string;
  creativeParsingRules: string;
};

function defaultDraft(): Draft {
  return {
    audienceStructure: DEFAULT_STRUCTURES.audienceStructure,
    topicStructure: DEFAULT_STRUCTURES.topicStructure,
    messagesStructure: DEFAULT_STRUCTURES.messagesStructure,
    creativeStructure: DEFAULT_STRUCTURES.creativeStructure,
    feedStructure: DEFAULT_STRUCTURES.feedStructure,
    creativeParsingRules: JSON.stringify(
      DEFAULT_CREATIVE_PARSING_RULES,
      null,
      2,
    ),
  };
}

function rowsToDraft(rows: ConfigRow[]): Draft {
  const d = defaultDraft();
  for (const r of rows) {
    if (r.key === "creativeParsingRules") {
      d.creativeParsingRules =
        typeof r.value === "string"
          ? r.value
          : JSON.stringify(r.value, null, 2);
      continue;
    }
    if (r.key in d && typeof r.value === "string") {
      (d as Record<string, string>)[r.key] = r.value;
    }
  }
  return d;
}

export function StructureTab() {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["config", "structure"],
    queryFn: async (): Promise<Draft> => {
      const r = await fetch("/api/config?category=structure");
      if (!r.ok) throw new Error("config fetch failed");
      const data = (await r.json()) as { rows: ConfigRow[] };
      return rowsToDraft(data.rows);
    },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [parsingRulesError, setParsingRulesError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (q.data && !draft) setDraft(q.data);
  }, [q.data, draft]);

  const m = useMutation({
    mutationFn: async (d: Draft) => {
      // Validate JSON before sending.
      let parsedRules: unknown;
      try {
        parsedRules = JSON.parse(d.creativeParsingRules);
      } catch (e) {
        throw new Error(
          `creativeParsingRules is not valid JSON: ${(e as Error).message}`,
        );
      }
      const writes: Array<{
        key: string;
        value: unknown;
        category: string;
      }> = [
        { key: "audienceStructure", value: d.audienceStructure, category: "structure" },
        { key: "topicStructure", value: d.topicStructure, category: "structure" },
        { key: "messagesStructure", value: d.messagesStructure, category: "structure" },
        { key: "creativeStructure", value: d.creativeStructure, category: "structure" },
        { key: "feedStructure", value: d.feedStructure, category: "structure" },
        { key: "creativeParsingRules", value: parsedRules, category: "structure" },
      ];
      for (const w of writes) {
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(w),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(`save failed for ${w.key}: ${body.error ?? r.status}`);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config", "structure"] });
    },
  });

  function setField<K extends keyof Draft>(k: K, v: Draft[K]) {
    if (!draft) return;
    setDraft({ ...draft, [k]: v });
    if (k === "creativeParsingRules") {
      try {
        JSON.parse(v as string);
        setParsingRulesError(null);
      } catch (e) {
        setParsingRulesError((e as Error).message);
      }
    }
  }

  function revert() {
    if (q.data) setDraft(q.data);
    setParsingRulesError(null);
  }

  if (!draft) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="structure-tab max-w-3xl">
      <SettingsHeaderActions>
        {m.isError ? (
          <span className="text-sm text-rose-600">
            {(m.error as Error).message}
          </span>
        ) : null}
        {m.isSuccess && !m.isPending ? (
          <span className="text-sm text-emerald-600">Saved</span>
        ) : null}
        <button
          type="button"
          onClick={revert}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Revert
        </button>
        <button
          type="button"
          onClick={() => m.mutate(draft)}
          disabled={m.isPending || parsingRulesError !== null}
          className="toolbar-btn--primary rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {m.isPending ? "Saving…" : "Save"}
        </button>
      </SettingsHeaderActions>
      <header className="mb-6">
        <p className="text-sm text-slate-500">
          Column orderings used by exports and the matrix UI, plus the rules
          that parse creative filenames into brand / product / type / MC
          metadata.
        </p>
      </header>

      <section className="structure-tab__section mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          CSV column order
        </h3>
        <div className="space-y-3">
          {STRUCTURE_KEYS.map(([key, label]) => (
            <label key={key} className="form-field block">
              <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
                {label}
              </span>
              <input
                type="text"
                value={draft[key]}
                onChange={(e) => setField(key, e.target.value)}
                className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="structure-tab__section mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Creative filename parsing
        </h3>
        <label className="form-field block">
          <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
            creativeParsingRules (JSON)
          </span>
          <textarea
            value={draft.creativeParsingRules}
            onChange={(e) => setField("creativeParsingRules", e.target.value)}
            rows={12}
            spellCheck={false}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
          />
          {parsingRulesError ? (
            <span className="form-field__hint mt-1 block text-xs text-rose-600">
              Invalid JSON: {parsingRulesError}
            </span>
          ) : (
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              Per-segment rules for splitting filenames. See{" "}
              <code className="font-mono">src/lib/parse-filename.ts</code>.
            </span>
          )}
        </label>
      </section>

    </div>
  );
}
