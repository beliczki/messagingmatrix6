"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PATTERNS,
  DEFAULT_STRUCTURES,
  DEFAULT_CREATIVE_PARSING_RULES,
} from "@/db/defaults";
import {
  defaultFeedPattern,
  parseFeedColumns,
} from "@/lib/feed-patterns";
import { SettingsHeaderActions } from "../SettingsView";

type ConfigRow = { key: string; value: unknown };

const STRUCTURE_KEYS = [
  ["audienceStructure", "Audience structure"],
  ["topicStructure", "Topic structure"],
  ["messagesStructure", "Messages structure"],
  ["creativeStructure", "Creative structure"],
  ["feedStructure", "Feed structure"],
] as const;

type Patterns = {
  pmmid?: string;
  audienceKey?: string;
  topicKey?: string;
  trafficking?: Record<string, string>;
  feed?: Record<string, string>;
  [key: string]: unknown;
};

type Draft = {
  audienceStructure: string;
  topicStructure: string;
  messagesStructure: string;
  creativeStructure: string;
  feedStructure: string;
  treeStructure: string;
  creativeParsingRules: string;
  feedPatterns: Record<string, string>;
  // Full patterns object preserved so we round-trip non-feed fields untouched.
  patternsBlob: Patterns;
};

// Sentinel for "patterns row missing on the server" so react-query treats it
// as resolved-but-empty rather than still loading.
const NO_PATTERNS: Patterns = {};

function defaultDraft(): Draft {
  return {
    audienceStructure: DEFAULT_STRUCTURES.audienceStructure,
    topicStructure: DEFAULT_STRUCTURES.topicStructure,
    messagesStructure: DEFAULT_STRUCTURES.messagesStructure,
    creativeStructure: DEFAULT_STRUCTURES.creativeStructure,
    feedStructure: DEFAULT_STRUCTURES.feedStructure,
    treeStructure: DEFAULT_STRUCTURES.treeStructure,
    creativeParsingRules: JSON.stringify(
      DEFAULT_CREATIVE_PARSING_RULES,
      null,
      2,
    ),
    feedPatterns: { ...(DEFAULT_PATTERNS.feed ?? {}) },
    patternsBlob: { ...DEFAULT_PATTERNS, feed: { ...DEFAULT_PATTERNS.feed } },
  };
}

function rowsToDraft(structureRows: ConfigRow[], patterns: Patterns): Draft {
  const d = defaultDraft();
  for (const r of structureRows) {
    if (r.key === "creativeParsingRules") {
      d.creativeParsingRules =
        typeof r.value === "string"
          ? r.value
          : JSON.stringify(r.value, null, 2);
      continue;
    }
    if (r.key in d && typeof r.value === "string") {
      (d as Record<string, string | unknown>)[r.key] = r.value;
    }
  }
  d.patternsBlob = patterns;
  d.feedPatterns = patterns.feed ?? {};
  return d;
}

export function StructureTab() {
  const qc = useQueryClient();

  const structureQ = useQuery({
    queryKey: ["config", "structure"],
    queryFn: async () => {
      const r = await fetch("/api/config?category=structure");
      if (!r.ok) throw new Error("config fetch failed");
      const data = (await r.json()) as { rows: ConfigRow[] };
      return data.rows;
    },
  });

  const patternsQ = useQuery({
    queryKey: ["config", "patterns"],
    queryFn: async (): Promise<Patterns> => {
      const r = await fetch("/api/config?key=patterns");
      if (!r.ok) throw new Error("patterns fetch failed");
      const data = (await r.json()) as { rows: ConfigRow[] };
      const value = data.rows[0]?.value;
      if (value && typeof value === "object") return value as Patterns;
      return NO_PATTERNS;
    },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [parsingRulesError, setParsingRulesError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (structureQ.data && patternsQ.data && !draft) {
      setDraft(rowsToDraft(structureQ.data, patternsQ.data));
    }
  }, [structureQ.data, patternsQ.data, draft]);

  const m = useMutation({
    mutationFn: async (d: Draft) => {
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
        { key: "treeStructure", value: d.treeStructure, category: "structure" },
        { key: "creativeParsingRules", value: parsedRules, category: "structure" },
        {
          key: "patterns",
          value: { ...d.patternsBlob, feed: d.feedPatterns },
          category: "patterns",
        },
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
      qc.invalidateQueries({ queryKey: ["config", "patterns"] });
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

  function setFeedPattern(column: string, value: string) {
    if (!draft) return;
    const next = { ...draft.feedPatterns };
    if (value.trim() === "") {
      delete next[column];
    } else {
      next[column] = value;
    }
    setDraft({ ...draft, feedPatterns: next });
  }

  function revert() {
    if (structureQ.data && patternsQ.data) {
      setDraft(rowsToDraft(structureQ.data, patternsQ.data));
    }
    setParsingRulesError(null);
  }

  const feedColumns = useMemo(
    () => (draft ? parseFeedColumns(draft.feedStructure) : []),
    [draft],
  );

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

      <section className="structure-tab__section structure-tab__section--tree mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Decision tree structure
        </h3>
        <p className="form-field__hint mb-3 text-xs text-slate-500">
          Hierarchy used by the matrix <strong>Decision Tree</strong> view.
          Levels are separated by <code className="font-mono">→</code>{" "}
          (U+2192). Each level is either a special token{" "}
          (<code className="font-mono">Audience</code>,{" "}
          <code className="font-mono">Topic</code>,{" "}
          <code className="font-mono">Messages</code>) or an audience/topic
          field name (e.g. <code className="font-mono">Product</code>,{" "}
          <code className="font-mono">Strategy</code>). Disambiguate with{" "}
          <code className="font-mono">Source.Field</code> when needed (e.g.{" "}
          <code className="font-mono">Topics.Tag1</code>).
        </p>
        <label className="form-field block">
          <input
            type="text"
            value={draft.treeStructure}
            onChange={(e) => setField("treeStructure", e.target.value)}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
          />
        </label>
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

      <section className="structure-tab__section structure-tab__section--key-patterns mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Key patterns
        </h3>
        <p className="form-field__hint mb-4 text-xs text-slate-500">
          Auto-generated <code className="font-mono">key</code> for new
          audiences / topics. Supports{" "}
          <code className="font-mono">{`{{field}}`}</code> placeholders, the{" "}
          <code className="font-mono">|lower</code> modifier (and other
          modifiers like <code className="font-mono">|upper</code>,{" "}
          <code className="font-mono">|trim</code>), and a top-level{" "}
          <code className="font-mono">join(...)</code> function that drops empty
          and literal <code className="font-mono">NA</code> values, joining the
          remaining ones with <code className="font-mono">_</code>. Leave empty
          for fallback (<code className="font-mono">aud{`{N}`}</code> /{" "}
          <code className="font-mono">top{`{N}`}</code>).
        </p>
        <div className="space-y-3">
          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              audienceKey
            </span>
            <input
              type="text"
              value={draft.patternsBlob.audienceKey ?? ""}
              placeholder="join({{product|lower}}, {{strategy|lower}}, {{device|lower}})"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  patternsBlob: {
                    ...draft.patternsBlob,
                    audienceKey: e.target.value,
                  },
                })
              }
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
            />
          </label>
          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              topicKey
            </span>
            <input
              type="text"
              value={draft.patternsBlob.topicKey ?? ""}
              placeholder="join({{product|lower}}, {{tag1|lower}}, {{tag2|lower}}, {{tag3|lower}}, {{tag4|lower}})"
              onChange={(e) =>
                setDraft({
                  ...draft,
                  patternsBlob: {
                    ...draft.patternsBlob,
                    topicKey: e.target.value,
                  },
                })
              }
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
            />
          </label>
        </div>
      </section>

      <section className="structure-tab__section structure-tab__section--feed-patterns mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Feed patterns
        </h3>
        <p className="form-field__hint mb-4 text-xs text-slate-500">
          One pattern per Feed structure column. Leave empty to use the
          built-in fallback. Patterns use{" "}
          <code className="font-mono">{`{{message_field}}`}</code> placeholders
          (e.g. <code className="font-mono">{`{{headline}}`}</code>,{" "}
          <code className="font-mono">{`{{number}}{{variant}}`}</code>) and may
          chain modifiers like{" "}
          <code className="font-mono">{`{{image1|noext}}`}</code>.
        </p>
        {feedColumns.length === 0 ? (
          <p className="text-sm italic text-slate-500">
            No feed columns yet. Define Feed structure above to populate this list.
          </p>
        ) : (
          <div className="space-y-2">
            {feedColumns.map((column) => {
              const value = draft.feedPatterns[column] ?? "";
              const fallback = defaultFeedPattern(column);
              return (
                <div
                  key={column}
                  className="feed-pattern-row flex items-center gap-3"
                >
                  <label
                    className="form-field__label w-56 flex-shrink-0 truncate font-mono text-xs text-slate-700"
                    title={column}
                  >
                    {column}
                  </label>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setFeedPattern(column, e.target.value)}
                    placeholder={fallback}
                    className="input-box flex-1 rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
                  />
                </div>
              );
            })}
            <p className="form-field__hint mt-3 text-xs text-slate-500">
              Add the <code className="font-mono">|formatted</code> modifier
              (e.g. <code className="font-mono">{`{{headline|formatted}}`}</code>)
              to wrap the column&apos;s value into per-size{" "}
              <code className="font-mono">{`<span class="text-{size}">…</span>`}</code>{" "}
              blocks sourced from text-formatter rules. Adform picks the right
              one at runtime.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
