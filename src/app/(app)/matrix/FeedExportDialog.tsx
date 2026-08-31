"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import AppDialog from "../_components/AppDialog";
import { type Audience, type Message } from "./types";
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
};

type PostBody = {
  product: string;
  defaultMessageId: number | null;
  forceNewVersion: boolean;
  signalColumn: string;
  notes: string | null;
  messageIds: number[];
};

// One export = one or more LEGS. A plain export is a single leg; a split is one
// leg per platform. Modelling the single case as a list of one keeps preview,
// commit and download from branching on `split` at every step.
type Leg = {
  platform: string;
  signalColumn: SignalColumn;
  label: string;
  messageIds: number[];
  mcOptions: ReturnType<typeof uniqueMcOptions>;
};

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
  audiences,
  messageIds,
}: {
  open: boolean;
  onClose: () => void;
  product: string;
  messages: Message[];
  audiences: Audience[];
  messageIds: number[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [forceNewVersion, setForceNewVersion] = useState(false);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState(false);
  const [signalColumn, setSignalColumn] =
    useState<SignalColumn>(DEFAULT_SIGNAL_COLUMN);
  // Default row per platform: a split writes two feeds, and each needs its own
  // fallback ad — the DEFAULT row carries the platform's own lineitem signal.
  const [defaults, setDefaults] = useState<Record<string, number | null>>({});
  const [result, setResult] = useState<CreateResponse[] | null>(null);

  const platformByAudience = useMemo(
    () => new Map(audiences.map((a) => [a.key, a.buyingPlatform])),
    [audiences],
  );

  // Messages whose audience names no buying platform cannot be assigned to
  // either half of a split. Dropping them silently would ship a feed that is
  // quietly missing rows, so the split refuses and names them instead.
  const unassigned = useMemo(
    () =>
      messages.filter((m) => {
        const p = platformByAudience.get(m.audience);
        return !p || !p.trim();
      }),
    [messages, platformByAudience],
  );

  const legs = useMemo<Leg[]>(() => {
    if (!split) {
      const platform = platformForSignalColumn(signalColumn);
      return [
        {
          platform,
          signalColumn,
          label: platform,
          messageIds,
          mcOptions: uniqueMcOptions(messages),
        },
      ];
    }
    const byPlatform = new Map<string, Message[]>();
    for (const m of messages) {
      const raw = platformByAudience.get(m.audience);
      const p = raw?.trim().toLowerCase();
      if (!p) continue;
      const list = byPlatform.get(p) ?? [];
      list.push(m);
      byPlatform.set(p, list);
    }
    return [...byPlatform.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([platform, msgs]) => ({
        platform,
        signalColumn: signalColumnForPlatform(platform),
        label: platform,
        messageIds: msgs.map((m) => m.id),
        mcOptions: uniqueMcOptions(msgs),
      }));
  }, [split, signalColumn, messages, messageIds, platformByAudience]);

  // Restore the saved default per (product, platform) whenever the leg set
  // changes — switching split on introduces platforms that had no entry yet.
  useEffect(() => {
    setDefaults((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const leg of legs) {
        if (leg.platform in next) continue;
        let saved: number | null = null;
        try {
          const raw = localStorage.getItem(
            `mm6_feed_export_default_${product}_${leg.platform}`,
          );
          const parsed = raw === null ? NaN : Number(raw);
          if (Number.isFinite(parsed)) saved = parsed;
        } catch {}
        next[leg.platform] = saved;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [legs, product]);

  function chooseDefault(platform: string, v: number | null) {
    setDefaults((prev) => ({ ...prev, [platform]: v }));
    try {
      const key = `mm6_feed_export_default_${product}_${platform}`;
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(v));
    } catch {}
  }

  const splitBlocked = split && unassigned.length > 0;

  // Live dry-run per leg: builds the row set + diff + decision on the server
  // without persisting, so the impact is visible before committing. One query
  // over all legs (not one query per leg) keeps the hook count fixed no matter
  // how many platforms the split finds.
  const previewQ = useQuery({
    queryKey: [
      "feed-export-preview",
      product,
      forceNewVersion,
      legs
        .map(
          (l) =>
            `${l.platform}:${defaults[l.platform] ?? "none"}:${l.messageIds.join(".")}`,
        )
        .join("|"),
    ],
    queryFn: () =>
      Promise.all(
        legs.map((leg) =>
          postFeedExport<PreviewResponse>({
            product,
            defaultMessageId: defaults[leg.platform] ?? null,
            forceNewVersion,
            signalColumn: leg.signalColumn,
            notes: null,
            messageIds: leg.messageIds,
            dryRun: true,
          }).then((r) => ({ leg, preview: r })),
        ),
      ),
    enabled: open && !result && !splitBlocked && legs.length > 0,
    staleTime: 30_000,
  });

  const createM = useMutation({
    // Sequential, not parallel: each leg's version decision reads the live
    // export for its own platform, and two in-flight writes for the same
    // platform could race. Different platforms cannot race each other, but
    // sequential keeps the audit order readable and costs nothing at n=2.
    mutationFn: async () => {
      const out: CreateResponse[] = [];
      for (const leg of legs) {
        out.push(
          await postFeedExport<CreateResponse>({
            product,
            defaultMessageId: defaults[leg.platform] ?? null,
            forceNewVersion,
            signalColumn: leg.signalColumn,
            notes: notes.trim() || null,
            messageIds: leg.messageIds,
          }),
        );
      }
      return out;
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["feed-exports", product] });
      qc.invalidateQueries({ queryKey: ["feed-exports", "all"] });
      // One file downloads directly; several arrive as a single zip so the
      // browser is not asked to accept a burst of downloads.
      const ids = data.map((d) => d.feedExport.id);
      window.location.href =
        ids.length === 1
          ? `/api/feed-exports/${ids[0]}?download=1`
          : `/api/feed-exports/zip?ids=${ids.join(",")}`;
    },
  });

  function close() {
    setResult(null);
    setForceNewVersion(false);
    setNotes("");
    createM.reset();
    onClose();
  }


  return (
    <AppDialog open={open} onClose={close} ariaLabel="Feed export preview">
      <div className="feed-export-dialog flex h-full flex-col overflow-hidden">
        <header className="feed-export-dialog__header flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 pr-14">
          <h2 className="text-base font-semibold text-slate-900">
            Feed export · {product}
          </h2>
          {!result ? (
            <button
              type="button"
              onClick={() => createM.mutate()}
              disabled={
                createM.isPending || previewQ.isLoading || splitBlocked
              }
              className="toolbar-btn--primary flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Download className="size-4" />
              {createM.isPending
                ? "Building…"
                : legs.length > 1
                  ? `Build & Download ${legs.length} feeds (zip)`
                  : "Build & Download XLSX"}
            </button>
          ) : null}
        </header>

        <div className="feed-export-dialog__body flex-1 overflow-auto px-6 py-4">
          {!result ? (
            <PreEmitForm
              forceNewVersion={forceNewVersion}
              setForceNewVersion={setForceNewVersion}
              notes={notes}
              setNotes={setNotes}
              split={split}
              setSplit={setSplit}
              signalColumn={signalColumn}
              setSignalColumn={setSignalColumn}
              legs={legs}
              defaults={defaults}
              chooseDefault={chooseDefault}
              unassigned={unassigned}
              splitBlocked={splitBlocked}
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
              onOpenDetail={(id) => {
                close();
                router.push(`/feeds/${id}`);
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
  setForceNewVersion,
  notes,
  setNotes,
  split,
  setSplit,
  signalColumn,
  setSignalColumn,
  legs,
  defaults,
  chooseDefault,
  unassigned,
  splitBlocked,
  error,
  isPending,
  preview,
  previewLoading,
  previewError,
}: {
  forceNewVersion: boolean;
  setForceNewVersion: (b: boolean) => void;
  notes: string;
  setNotes: (s: string) => void;
  split: boolean;
  setSplit: (b: boolean) => void;
  signalColumn: SignalColumn;
  setSignalColumn: (v: SignalColumn) => void;
  legs: Leg[];
  defaults: Record<string, number | null>;
  chooseDefault: (platform: string, v: number | null) => void;
  unassigned: Message[];
  splitBlocked: boolean;
  error: Error | null;
  isPending: boolean;
  preview: Array<{ leg: Leg; preview: PreviewResponse }> | null;
  previewLoading: boolean;
  previewError: Error | null;
}) {
  return (
    <div className="space-y-4">
      {previewLoading && !preview ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Computing diff against the live AdForm baseline…
        </div>
      ) : previewError ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <strong>Preview failed:</strong> {previewError.message}
        </div>
      ) : preview ? (
        preview.map(({ leg, preview: p }) => (
        <PreviewBlock
          key={leg.platform}
          platform={legs.length > 1 ? leg.platform : null}
          decision={p.decision}
          diff={p.diff}
          rowCount={p.previewRowCount}
        />
        ))
      ) : null}

      <div className="feed-export-dialog__options space-y-3 border-t border-slate-200 pt-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
          Split by platform (one feed per buying platform, delivered as a zip)
        </label>

        {splitBlocked ? (
          <div className="feed-export-dialog__split-blocked rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" />
              <div>
                <div className="font-medium">
                  {unassigned.length} row
                  {unassigned.length === 1 ? "" : "s"} have no buying platform
                </div>
                <p className="mt-1 leading-snug">
                  A split cannot place them, and leaving them out would ship a
                  feed quietly missing rows. Set a buying platform on these
                  audiences, or export without splitting.
                </p>
                <ul className="mt-1 list-disc pl-4">
                  {[...new Set(unassigned.map((m) => m.audience))]
                    .slice(0, 8)
                    .map((a) => (
                      <li key={a} className="font-mono">
                        {a}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        {!split ? (
          <label className="form-field feed-export-dialog__signal block">
            <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
              Signal column
            </span>
            <select
              value={signalColumn}
              onChange={(e) => setSignalColumn(e.target.value as SignalColumn)}
              className="input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
              title="Header name for the lineitem-signal column. AdForm and DV360 expect different names for the same value."
            >
              {SIGNAL_COLUMN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {legs.map((leg) => (
          <label
            key={leg.platform}
            className="form-field feed-export-dialog__default block"
          >
            <span className="form-field__label mb-1 block text-xs font-medium text-slate-700">
              Default row{legs.length > 1 ? ` · ${leg.label}` : ""}
              <span className="ml-1 font-normal text-slate-400">
                ({leg.messageIds.length} row
                {leg.messageIds.length === 1 ? "" : "s"})
              </span>
            </span>
            <select
              value={defaults[leg.platform] ?? ""}
              onChange={(e) =>
                chooseDefault(
                  leg.platform,
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              className="input-box w-full rounded border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            >
              <option value="">— no default row —</option>
              {leg.mcOptions.map((o) => (
                <option key={o.key} value={o.messageId}>
                  {o.label}
                  {o.count > 1 ? ` (${o.count} variants)` : ""}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={forceNewVersion}
            onChange={(e) => setForceNewVersion(e.target.checked)}
          />
          Force new feed version (bumps version even if append would be allowed)
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
  platform,
}: {
  decision: Decision;
  diff: DiffPreview;
  rowCount: number;
  platform?: string | null;
}) {
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
      {platform ? (
        <div className="feed-export-dialog__leg-heading text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {platform}
        </div>
      ) : null}
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
        <Stat label="Added" value={diff.added} tone="ok" />
        <Stat label="Changed" value={diff.changed} />
        <Stat
          label="Removed"
          value={diff.removed}
          tone={diff.removed > 0 ? "warn" : "neutral"}
        />
      </div>

      <details className="rounded border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          Diff details
        </summary>
        <DiffSection title="Added rows" rows={diff.addedPreview} />
        <DiffSection title="Removed rows" rows={diff.removedPreview} />
        <ChangedSection rows={diff.changedPreview} />
      </details>
    </div>
  );
}

function PostEmitView({
  result,
  onOpenDetail,
}: {
  result: CreateResponse[];
  onClose: () => void;
  onOpenDetail: (id: number) => void;
}) {
  return (
    <div className="space-y-6">
      {result.map((r) => (
        <PostEmitLeg
          key={r.feedExport.id}
          result={r}
          showHeading={result.length > 1}
          onOpenDetail={() => onOpenDetail(r.feedExport.id)}
        />
      ))}
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          {result.length > 1
            ? `${result.length} feeds downloaded as a zip.`
            : "XLSX downloaded."}{" "}
          Once you upload {result.length > 1 ? "them" : "it"} to the platform,
          mark {result.length > 1 ? "each export" : "this export"} as uploaded
          from the{" "}
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

function PostEmitLeg({
  result,
  showHeading,
  onOpenDetail,
}: {
  result: CreateResponse;
  showHeading: boolean;
  onOpenDetail: () => void;
}) {
  const { decision, diff, feedExport } = result;
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
      {showHeading ? (
        <div className="feed-export-dialog__leg-heading text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {feedExport.platform}
        </div>
      ) : null}
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
        <Stat label="Added" value={diff.added} tone="ok" />
        <Stat label="Changed" value={diff.changed} />
        <Stat
          label="Removed"
          value={diff.removed}
          tone={diff.removed > 0 ? "warn" : "neutral"}
        />
      </div>

      <details className="rounded border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          Diff details
        </summary>
        <DiffSection title="Added rows" rows={diff.addedPreview} />
        <DiffSection title="Removed rows" rows={diff.removedPreview} />
        <ChangedSection rows={diff.changedPreview} />
      </details>

      <button
        type="button"
        onClick={onOpenDetail}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        Open {feedExport.filename} &rarr;
      </button>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "neutral";
}) {
  const color =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-700";
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
    </div>
  );
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
        {title} ({rows.length}
        {rows.length === 50 ? "+" : ""})
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
