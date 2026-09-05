"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import AppDialog from "../_components/AppDialog";
import BaselinePicker from "./BaselinePicker";
import { type Message } from "./types";
import {
  DEFAULT_SIGNAL_COLUMN,
  isValidSignalColumn,
  platformForSignalColumn,
  signalColumnForPlatform,
  SIGNAL_COLUMN_OPTIONS,
  type SignalColumn,
} from "@/lib/feed-signal";

type Decision = {
  feedVersion: number;
  action: "first" | "append" | "new_version";
  reasons: string[];
};

type DiffPreview = {
  added: number;
  removed: number;
  changed: number;
  unchangedCount: number;
  addedPreview: Record<string, string>[];
  removedPreview: Record<string, string>[];
  changedPreview: Array<{
    fields: string[];
    prev: Record<string, string> | null;
    next: Record<string, string> | null;
  }>;
  source: "adform_snapshot" | "mm6_last_export" | "none";
  snapshot: {
    filename: string;
    uploadedAt: string;
    rowCount: number;
  } | null;
};

type CreateResponse = {
  feedExport: {
    id: number;
    feedVersion: number;
    rowCount: number;
    platform: string;
    filename: string;
  };
  decision: Decision;
  diff: DiffPreview;
};

type PreviewResponse = {
  feedExport: null;
  decision: Decision;
  diff: DiffPreview;
  previewRowCount: number;
  /** Name the export would download as; the id reads "new" until it exists. */
  filenamePreview: string;
};

type PostBody = {
  product: string;
  defaultMessageId: number | null;
  forceNewVersion: boolean;
  signalColumn: string;
  baselineExportId: number | null;
  notes: string | null;
  messageIds: number[];
};

type ExportMode = "append" | "new";

/** Which slice of the diff the details list shows. */
type DiffFilter = "all" | "added" | "changed" | "off";

/** An earlier feed for this product, offered as the diff baseline. */
type BaselineOption = {
  id: number;
  product: string;
  filename: string;
  platform: string;
  defaultMessageId: number | null;
  defaultLabel: string | null;
  feedVersion: number;
  source: string;
  exportedAt: string;
  uploadedToAdformAt: string | null;
};

// The export writes one feed. Splitting by platform used to live here, but the
// filter in the matrix already decides which slice is being exported, so the
// dialog only has to name the default row and the signal header for that slice.

function uniqueMcOptions(messages: Message[]) {
  const seen = new Map<
    string,
    { key: string; label: string; messageId: number; count: number }
  >();
  for (const m of messages) {
    const key = `${m.number}${m.variant}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const label = m.name
      ? `MC${m.number}${m.variant} — ${m.name}`
      : `MC${m.number}${m.variant}`;
    seen.set(key, { key, label, messageId: m.id, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function postFeedExport<T>(body: PostBody & { dryRun?: boolean }): Promise<T> {
  const r = await fetch("/api/feed-exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.reason ?? err.error ?? `${r.status}`);
  }
  return r.json() as Promise<T>;
}

export default function FeedExportDialog({
  open,
  onClose,
  product,
  messages,
  messageIds,
}: {
  open: boolean;
  onClose: () => void;
  product: string;
  messages: Message[];
  messageIds: number[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  // Two genuinely different acts, not a modifier on one: Append continues an
  // existing feed (so it needs a baseline, and inherits that feed's signal and
  // DEFAULT row), New Feed starts a fresh one (so it needs those chosen, and
  // there is nothing to diff against).
  const [mode, setMode] = useState<ExportMode>("append");
  const forceNewVersion = mode === "new";
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CreateResponse | null>(null);
  const [signalColumn, setSignalColumn] =
    useState<SignalColumn>(DEFAULT_SIGNAL_COLUMN);
  const [defaultMessageId, setDefaultMessageId] = useState<number | null>(null);
  const [baselineExportId, setBaselineExportId] = useState<number | null>(null);

  // Every earlier feed for this product is offerable; the newest is the default
  // because that is what the export would have built on anyway.
  const baselinesQ = useQuery({
    queryKey: ["feed-exports", "baselines", product],
    queryFn: async (): Promise<BaselineOption[]> => {
      const r = await fetch("/api/feed-exports", { credentials: "include" });
      if (!r.ok) return [];
      const data = (await r.json()) as { feedExports: BaselineOption[] };
      return data.feedExports.filter((f) => f.product === product);
    },
    enabled: open,
  });
  const baselines = useMemo(() => {
    const rows = [...(baselinesQ.data ?? [])];
    // Newest first, published ones ranked by when they went live and the rest
    // by when they were built — the same ordering the server falls back to.
    rows.sort((a, b) =>
      (b.uploadedToAdformAt ?? b.exportedAt).localeCompare(
        a.uploadedToAdformAt ?? a.exportedAt,
      ),
    );
    return rows;
  }, [baselinesQ.data]);

  // Best guess instead of an "automatic" row: the newest LIVE feed, because
  // that is what a new export continues. Falling back to the newest built one
  // when nothing is live yet. Only fires while nothing is chosen, so a manual
  // pick is never overridden.
  useEffect(() => {
    if (baselineExportId !== null || baselines.length === 0) return;
    const live = baselines.find((b) => b.uploadedToAdformAt);
    setBaselineExportId((live ?? baselines[0]).id);
  }, [baselines, baselineExportId]);


  // The DEFAULT row is the feed's fallback ad, and the server resolves it
  // against every message of the client — not the export's selection. The
  // options here come from the current filter, so a baseline whose default sits
  // outside that filter had no <option> to select and the field silently read
  // "no default row". Carry the baseline's own default in as an option so the
  // choice it already made survives.
  // With a baseline and no forced new version, this export continues that feed:
  // its signal header and its DEFAULT row are already decided, and letting them
  // be re-chosen only produces a row that fails to match.
  const boundToBaseline = mode === "append" && baselineExportId !== null;
  const sentBaselineId = mode === "append" ? baselineExportId : null;

  const baseline = useMemo(
    () => baselines.find((b) => b.id === baselineExportId) ?? null,
    [baselines, baselineExportId],
  );
  const mcOptions = useMemo(() => {
    const opts = uniqueMcOptions(messages);
    const fromBaseline = baseline?.defaultMessageId;
    if (fromBaseline != null && !opts.some((o) => o.messageId === fromBaseline)) {
      opts.unshift({
        key: `baseline-${fromBaseline}`,
        label: `${baseline?.defaultLabel ?? `#${fromBaseline}`} (from baseline, outside this filter)`,
        messageId: fromBaseline,
        count: 1,
      });
    }
    return opts;
  }, [messages, baseline]);
  const platform = platformForSignalColumn(signalColumn);

  // The default row is remembered per (product, platform): the same product
  // exported for the same platform wants the same fallback ad every time.
  const storageKey = `mm6_feed_export_default_${product}_${platform}`;
  useEffect(() => {
    // Only when the baseline is automatic. With a baseline picked, ITS default
    // is the answer — and since choosing one also changes the signal column,
    // and the signal column is part of this key, an unguarded restore would
    // fire right after and overwrite the value the baseline just supplied.
    if (baselineExportId !== null) return;
    let saved: number | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw === null ? NaN : Number(raw);
      if (Number.isFinite(parsed)) saved = parsed;
    } catch {}
    setDefaultMessageId(saved);
  }, [storageKey, baselineExportId]);

  // Choosing a baseline is choosing what this export continues, so it also
  // answers "which platform" and "which fallback ad" — asking again would only
  // let the two disagree. A later manual change still wins; this only fires
  // when the baseline itself changes.
  useEffect(() => {
    if (baselineExportId === null) return;
    if (!baseline) return;
    setSignalColumn(signalColumnForPlatform(baseline.platform));
    setDefaultMessageId(baseline.defaultMessageId);
  }, [baselineExportId, baseline]);

  function chooseDefault(v: number | null) {
    setDefaultMessageId(v);
    try {
      if (v === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(v));
    } catch {}
  }


  // Live dry-run: builds the row set + diff + decision on the server without
  // persisting, so the impact is visible before committing.
  const previewQ = useQuery({
    queryKey: [
      "feed-export-preview",
      product,
      forceNewVersion,
      signalColumn,
      sentBaselineId ?? "none",
      defaultMessageId ?? "none",
      messageIds.join(","),
    ],
    queryFn: () =>
      postFeedExport<PreviewResponse>({
        product,
        defaultMessageId,
        forceNewVersion,
        signalColumn,
        baselineExportId: sentBaselineId,
        notes: null,
        messageIds,
        dryRun: true,
      }),
    enabled: open && !result,
    staleTime: 30_000,
  });

  const createM = useMutation({
    mutationFn: () =>
      postFeedExport<CreateResponse>({
        product,
        defaultMessageId,
        forceNewVersion,
        signalColumn,
        baselineExportId: sentBaselineId,
        notes: notes.trim() || null,
        messageIds,
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["feed-exports", product] });
      qc.invalidateQueries({ queryKey: ["feed-exports", "all"] });
      window.location.href = `/api/feed-exports/${data.feedExport.id}?download=1`;
    },
  });

  function close() {
    setResult(null);
    setMode("append");
    setNotes("");
    createM.reset();
    onClose();
  }


  return (
    <AppDialog open={open} onClose={close} ariaLabel="Feed export preview">
      <div className="feed-export-dialog flex h-full flex-col overflow-hidden">
        <header className="feed-export-dialog__header flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 pr-14">
          <h2 className="text-base font-semibold text-slate-900">
            Feed export ·{" "}
            <span className="font-mono text-sm">
              {result?.feedExport.filename ??
                previewQ.data?.filenamePreview ??
                product}
            </span>
          </h2>
          {!result ? (
            <button
              type="button"
              onClick={() => createM.mutate()}
              disabled={
                createM.isPending ||
                previewQ.isLoading ||
                (mode === "append" && baselineExportId === null)
              }
              className="toolbar-btn--primary flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="size-4" />
              {createM.isPending ? "Building…" : "Build & Download XLSX"}
            </button>
          ) : null}
        </header>

        <div className="feed-export-dialog__body flex-1 overflow-auto px-6 py-4">
          {!result ? (
            <PreEmitForm
              forceNewVersion={forceNewVersion}
              notes={notes}
              setNotes={setNotes}
              mode={mode}
              setMode={setMode}
              boundToBaseline={boundToBaseline}
              signalColumn={signalColumn}
              setSignalColumn={setSignalColumn}
              baselines={baselines}
              baselineExportId={baselineExportId}
              setBaselineExportId={setBaselineExportId}
              mcOptions={mcOptions}
              defaultMessageId={defaultMessageId}
              chooseDefault={chooseDefault}
              error={createM.error as Error | null}
              isPending={createM.isPending}
              preview={previewQ.data ?? null}
              previewLoading={previewQ.isLoading}
              previewError={previewQ.error as Error | null}
            />
          ) : (
            <PostEmitView
              result={result}
              onClose={close}
              onOpenDetail={() => {
                close();
                router.push(`/feeds/${result.feedExport.id}`);
              }}
            />
          )}
        </div>
      </div>
    </AppDialog>
  );
}

function PreEmitForm({
  forceNewVersion,
  notes,
  setNotes,
  mode,
  setMode,
  boundToBaseline,
  signalColumn,
  setSignalColumn,
  baselines,
  baselineExportId,
  setBaselineExportId,
  mcOptions,
  defaultMessageId,
  chooseDefault,
  error,
  isPending,
  preview,
  previewLoading,
  previewError,
}: {
  forceNewVersion: boolean;
  notes: string;
  setNotes: (s: string) => void;
  mode: ExportMode;
  setMode: (m: ExportMode) => void;
  boundToBaseline: boolean;
  signalColumn: SignalColumn;
  setSignalColumn: (v: SignalColumn) => void;
  baselines: BaselineOption[];
  baselineExportId: number | null;
  setBaselineExportId: (v: number | null) => void;
  mcOptions: ReturnType<typeof uniqueMcOptions>;
  defaultMessageId: number | null;
  chooseDefault: (v: number | null) => void;
  error: Error | null;
  isPending: boolean;
  preview: PreviewResponse | null;
  previewLoading: boolean;
  previewError: Error | null;
}) {
  return (
    <div className="space-y-4">
      <div className="feed-export-dialog__options space-y-3">
        <div className="feed-export-dialog__mode" role="radiogroup" aria-label="Export mode">
          <div className="mode-switch grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: "append" as const,
                  title: "Append",
                  desc: "Continue an existing feed. Nothing is ever deleted — rows outside this selection go out switched off.",
                },
                {
                  key: "new" as const,
                  title: "New feed",
                  desc: "Start a fresh feed. Only this selection goes out, and you choose the signal and DEFAULT row.",
                },
              ]
            ).map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setMode(m.key)}
                  className={clsx(
                    "mode-switch__option rounded-md border px-3 py-2 text-left transition",
                    on
                      ? "mode-switch__option--active border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                  )}
                >
                  <span className="mode-switch__title block text-sm font-medium">
                    {m.title}
                  </span>
                  <span
                    className={clsx(
                      "mode-switch__desc mt-0.5 block text-[11px] leading-snug",
                      on ? "text-slate-300" : "text-slate-500",
                    )}
                  >
                    {m.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {mode === "append" ? (
          <div className="form-field feed-export-dialog__baseline">
            <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
              Compare against
            </span>
            <BaselinePicker
              options={baselines}
              value={baselineExportId}
              onChange={setBaselineExportId}
            />
          </div>
        ) : null}

        <label className="form-field feed-export-dialog__signal block">
          <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
            Signal column
            {boundToBaseline ? (
              <span className="ml-1 font-normal text-slate-400">
                — from the compared feed
              </span>
            ) : null}
          </span>
          <select
            value={signalColumn}
            disabled={boundToBaseline}
            onChange={(e) => setSignalColumn(e.target.value as SignalColumn)}
            className="input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
            title="Header name for the lineitem-signal column. AdForm and DV360 expect different names for the same value."
          >
            {SIGNAL_COLUMN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field feed-export-dialog__default block">
          <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
            Default row
            {boundToBaseline ? (
              <span className="ml-1 font-normal text-slate-400">
                — the compared feed&apos;s own row goes out unchanged
              </span>
            ) : null}
          </span>
          <select
            value={defaultMessageId ?? ""}
            disabled={boundToBaseline}
            onChange={(e) =>
              chooseDefault(e.target.value === "" ? null : Number(e.target.value))
            }
            className="input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
          >
            <option value="">— no default row —</option>
            {mcOptions.map((o) => (
              <option key={o.key} value={o.messageId}>
                {o.label}
                {o.count > 1 ? ` (${o.count} variants)` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field block">
          <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Why this export, what changed since last…"
            className="input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="feed-export-dialog__diff space-y-4 border-t border-slate-200 pt-4">
      {mode === "new" ? (
        // A fresh feed has nothing to be different from, so the diff is not
        // hidden noise — it does not exist. Only the size of what goes out.
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          New feed — nothing to compare against.{" "}
          {preview ? (
            <>
              <strong>{preview.previewRowCount}</strong> rows go out, and only
              what this filter selects.
            </>
          ) : null}
        </div>
      ) : !boundToBaseline ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Pick a feed to compare against — appending continues that feed, so it
          decides what carries forward, the signal header and the DEFAULT row.
        </div>
      ) : previewLoading && !preview ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Computing the diff against the chosen baseline…
        </div>
      ) : previewError ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <strong>Preview failed:</strong> {previewError.message}
        </div>
      ) : preview ? (
        <PreviewBlock
          decision={preview.decision}
          diff={preview.diff}
          rowCount={preview.previewRowCount}
          forceNewVersion={forceNewVersion}
        />
      ) : null}
      </div>

      {error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <strong>Failed:</strong> {error.message}
        </div>
      ) : null}

      {isPending ? (
        <div className="text-xs text-slate-500">Building feed…</div>
      ) : null}
    </div>
  );
}

function PreviewBlock({
  decision,
  diff,
  rowCount,
  forceNewVersion,
}: {
  decision: Decision;
  diff: DiffPreview;
  rowCount: number;
  forceNewVersion: boolean;
}) {
  // Which slice of the diff the details list shows. Local to each block so the
  // preview and the result view do not share a selection.
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [query, setQuery] = useState("");
  const action =
    decision.action === "first"
      ? { label: "First export (v1)", tone: "ok" as const }
      : decision.action === "append"
        ? { label: `Append to v${decision.feedVersion}`, tone: "ok" as const }
        : {
            label: `New version v${decision.feedVersion}`,
            tone: "warn" as const,
          };

  return (
    <div className="space-y-3">
      <div className="diff-source rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {diff.source === "adform_snapshot" && diff.snapshot ? (
          <>
            Diff vs <strong>actual AdForm state</strong> from{" "}
            <span className="font-mono text-[11px]">{diff.snapshot.filename}</span>{" "}
            ({diff.snapshot.rowCount} rows, uploaded{" "}
            {new Date(diff.snapshot.uploadedAt).toLocaleDateString()}). Matched
            by PMMID.
          </>
        ) : diff.source === "mm6_last_export" ? (
          <>
            Diff vs <strong>last MM6 export uploaded to AdForm</strong>. Upload an
            AdForm reference in /feeds to diff against actual AdForm state instead.
          </>
        ) : (
          <>
            No baseline to diff against — this is the first export and no AdForm
            reference is uploaded.
          </>
        )}
      </div>

      <div
        className={
          action.tone === "ok"
            ? "rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            : "rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        }
      >
        <div className="flex items-center gap-2 font-medium">
          {action.tone === "ok" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
          {action.label}
        </div>
        {decision.reasons.length > 0 ? (
          <ul className="mt-1 list-inside list-disc text-xs">
            {decision.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Rows" value={rowCount} />
        <Stat
          label="Added"
          value={diff.added}
          tone="ok"
          active={filter === "added"}
          onClick={() => setFilter(filter === "added" ? "all" : "added")}
        />
        <Stat
          label="Changed"
          value={diff.changed}
          active={filter === "changed"}
          onClick={() => setFilter(filter === "changed" ? "all" : "changed")}
        />
        <Stat
          // Not "removed": a row the baseline carries that is not in this
          // selection stays in the file with IsActive=FALSE. It only leaves on
          // a new version, which is what the label says when that is the case.
          label={forceNewVersion ? "Dropped" : "Switched off"}
          value={diff.removed}
          tone={diff.removed > 0 ? "warn" : "neutral"}
          active={filter === "off"}
          onClick={() => setFilter(filter === "off" ? "all" : "off")}
        />
      </div>

      <details
        className="rounded border border-slate-200 bg-white p-3 text-xs"
        open={filter !== "all"}
      >
        <summary className="cursor-pointer font-medium text-slate-700">
          Diff details
          {filter !== "all" ? (
            <span className="ml-2 font-normal text-slate-500">
              — {filter === "off" ? "switched off" : filter} only
            </span>
          ) : null}
        </summary>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter these rows — MC number, PMMID, an image name…"
          className="input-box diff-details__filter mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
        />
        {filter === "all" || filter === "added" ? (
          <DiffSection
            title="Added rows"
            rows={matchRows(diff.addedPreview, query)}
          />
        ) : null}
        {filter === "all" || filter === "off" ? (
          <DiffSection
            title={forceNewVersion ? "Dropped rows" : "Switched off rows"}
            rows={matchRows(diff.removedPreview, query)}
          />
        ) : null}
        {filter === "all" || filter === "changed" ? (
          <ChangedSection rows={matchChanged(diff.changedPreview, query)} />
        ) : null}
      </details>
    </div>
  );
}

function PostEmitView({
  result,
  onOpenDetail,
}: {
  result: CreateResponse;
  onClose: () => void;
  onOpenDetail: () => void;
}) {
  const { decision, diff, feedExport } = result;
  const forceNewVersion = decision.action === "new_version";
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [query, setQuery] = useState("");
  const action =
    decision.action === "first"
      ? { label: "First export (v1)", tone: "ok" }
      : decision.action === "append"
        ? { label: `Append to v${decision.feedVersion}`, tone: "ok" }
        : {
            label: `New version v${decision.feedVersion}`,
            tone: "warn",
          };

  return (
    <div className="space-y-4">
      <div
        className={
          action.tone === "ok"
            ? "rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            : "rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        }
      >
        <div className="flex items-center gap-2 font-medium">
          {action.tone === "ok" ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
          {action.label}
        </div>
        {decision.reasons.length > 0 ? (
          <ul className="mt-1 list-inside list-disc text-xs">
            {decision.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="diff-source rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {diff.source === "adform_snapshot" && diff.snapshot ? (
          <>
            Diff vs <strong>actual AdForm state</strong> from{" "}
            <span className="font-mono text-[11px]">{diff.snapshot.filename}</span>{" "}
            ({diff.snapshot.rowCount} rows, uploaded{" "}
            {new Date(diff.snapshot.uploadedAt).toLocaleDateString()}). Matched
            by PMMID.
          </>
        ) : diff.source === "mm6_last_export" ? (
          <>
            Diff vs <strong>last MM6 export uploaded to AdForm</strong>. Upload an
            AdForm download to diff against actual AdForm state instead.
          </>
        ) : (
          <>
            No baseline to diff against — this is the first export and no AdForm
            snapshot is uploaded.
          </>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <Stat label="Rows" value={feedExport.rowCount} />
        <Stat
          label="Added"
          value={diff.added}
          tone="ok"
          active={filter === "added"}
          onClick={() => setFilter(filter === "added" ? "all" : "added")}
        />
        <Stat
          label="Changed"
          value={diff.changed}
          active={filter === "changed"}
          onClick={() => setFilter(filter === "changed" ? "all" : "changed")}
        />
        <Stat
          // Not "removed": a row the baseline carries that is not in this
          // selection stays in the file with IsActive=FALSE. It only leaves on
          // a new version, which is what the label says when that is the case.
          label={forceNewVersion ? "Dropped" : "Switched off"}
          value={diff.removed}
          tone={diff.removed > 0 ? "warn" : "neutral"}
          active={filter === "off"}
          onClick={() => setFilter(filter === "off" ? "all" : "off")}
        />
      </div>

      <details
        className="rounded border border-slate-200 bg-white p-3 text-xs"
        open={filter !== "all"}
      >
        <summary className="cursor-pointer font-medium text-slate-700">
          Diff details
          {filter !== "all" ? (
            <span className="ml-2 font-normal text-slate-500">
              — {filter === "off" ? "switched off" : filter} only
            </span>
          ) : null}
        </summary>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter these rows — MC number, PMMID, an image name…"
          className="input-box diff-details__filter mt-2 w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
        />
        {filter === "all" || filter === "added" ? (
          <DiffSection
            title="Added rows"
            rows={matchRows(diff.addedPreview, query)}
          />
        ) : null}
        {filter === "all" || filter === "off" ? (
          <DiffSection
            title={forceNewVersion ? "Dropped rows" : "Switched off rows"}
            rows={matchRows(diff.removedPreview, query)}
          />
        ) : null}
        {filter === "all" || filter === "changed" ? (
          <ChangedSection rows={matchChanged(diff.changedPreview, query)} />
        ) : null}
      </details>

      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          <span className="font-mono">{feedExport.filename}</span> downloaded.
          Once you upload it to the platform, mark this export as uploaded from{" "}
          <button
            type="button"
            onClick={onOpenDetail}
            className="font-medium text-blue-600 hover:underline"
          >
            its detail page
          </button>{" "}
          or the{" "}
          <Link
            href="/feeds"
            className="font-medium text-blue-600 hover:underline"
          >
            Feeds list
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "neutral";
  /** Selected as the diff-details filter. Omit onClick for a plain readout. */
  active?: boolean;
  onClick?: () => void;
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-700";
  const body = (
    <>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </>
  );
  if (!onClick) {
    return (
      <div className="feed-diff-stat rounded border border-slate-200 bg-white px-2 py-1.5">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "feed-diff-stat feed-diff-stat--filter rounded border px-2 py-1.5 text-left transition",
        active
          ? "feed-diff-stat--active border-slate-900 bg-slate-50"
          : "border-slate-200 bg-white hover:border-slate-400",
      )}
    >
      {body}
    </button>
  );
}

// Substring match across every cell, so "331" finds the MC and "_n2.jpg" finds
// the image swap without knowing which column either lives in.
function matchRows(
  rows: Record<string, string>[],
  query: string,
): Record<string, string>[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    Object.values(r).some((v) => (v ?? "").toLowerCase().includes(q)),
  );
}

function matchChanged(
  rows: Array<{
    fields: string[];
    prev: Record<string, string> | null;
    next: Record<string, string> | null;
  }>,
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => {
    const hay = [
      ...c.fields,
      ...Object.values(c.prev ?? {}),
      ...Object.values(c.next ?? {}),
    ];
    return hay.some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

function DiffSection({
  title,
  rows,
}: {
  title: string;
  rows: Record<string, string>[];
}) {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0]).slice(0, 4);
  return (
    <div className="mt-3">
      <div className="font-medium text-slate-700">
        {title} ({rows.length})
      </div>
      <table className="mt-1 w-full border-collapse text-[10px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {cols.map((c) => (
              <th key={c} className="py-1 pr-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              {cols.map((c) => (
                <td key={c} className="py-1 pr-2 text-slate-700">
                  {r[c]?.slice(0, 40)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangedSection({
  rows,
}: {
  rows: Array<{
    fields: string[];
    prev: Record<string, string> | null;
    next: Record<string, string> | null;
  }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="font-medium text-slate-700">
        Changed rows ({rows.length}
        {rows.length === 50 ? "+" : ""})
      </div>
      <ul className="mt-1 space-y-2 text-[10px]">
        {rows.map((c, i) => (
          <li key={i} className="rounded bg-slate-50 p-2">
            <div className="text-slate-500">
              fields: {c.fields.slice(0, 6).join(", ")}
              {c.fields.length > 6 ? ` … (+${c.fields.length - 6})` : ""}
            </div>
            {c.prev && c.next
              ? c.fields.slice(0, 3).map((f) => (
                  <div key={f} className="mt-0.5 grid grid-cols-2 gap-2">
                    <div className="text-rose-700 line-through">
                      {f}: {c.prev?.[f]?.slice(0, 60)}
                    </div>
                    <div className="text-emerald-700">
                      {f}: {c.next?.[f]?.slice(0, 60)}
                    </div>
                  </div>
                ))
              : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
