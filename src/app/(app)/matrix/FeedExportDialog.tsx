"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import AppDialog from "../_components/AppDialog";

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
  feedExport: { id: number; feedVersion: number; rowCount: number };
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
  notes: string | null;
  messageIds: number[];
};

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
  defaultMessageId,
  messageIds,
}: {
  open: boolean;
  onClose: () => void;
  product: string;
  defaultMessageId: number | null;
  messageIds: number[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [forceNewVersion, setForceNewVersion] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<CreateResponse | null>(null);

  // Live dry-run: builds the row set + diff + decision on the server without
  // persisting, so the user sees impact before clicking Build & Download.
  // Re-fires when forceNewVersion toggles (the decision depends on it).
  const previewQ = useQuery({
    queryKey: [
      "feed-export-preview",
      product,
      defaultMessageId ?? "none",
      forceNewVersion,
      messageIds.join(","),
    ],
    queryFn: () =>
      postFeedExport<PreviewResponse>({
        product,
        defaultMessageId,
        forceNewVersion,
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
        notes: notes.trim() || null,
        messageIds,
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["feed-exports", product] });
      qc.invalidateQueries({ queryKey: ["feed-exports", "all"] });
      // Auto-trigger download.
      window.location.href = `/api/feed-exports/${data.feedExport.id}?download=1`;
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
              disabled={createM.isPending || previewQ.isLoading}
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
              setForceNewVersion={setForceNewVersion}
              notes={notes}
              setNotes={setNotes}
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
  setForceNewVersion,
  notes,
  setNotes,
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
  error: Error | null;
  isPending: boolean;
  preview: PreviewResponse | null;
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
        <PreviewBlock
          decision={preview.decision}
          diff={preview.diff}
          rowCount={preview.previewRowCount}
        />
      ) : null}

      <div className="space-y-3 border-t border-slate-200 pt-4">
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
}: {
  decision: Decision;
  diff: DiffPreview;
  rowCount: number;
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
  result: CreateResponse;
  onClose: () => void;
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

      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          XLSX downloaded. Once you upload it to AdForm, mark this export as
          uploaded from{" "}
          <button
            type="button"
            onClick={onOpenDetail}
            className="font-medium text-blue-600 hover:underline"
          >
            its detail page
          </button>{" "}
          or the{" "}
          <Link href="/feeds" className="font-medium text-blue-600 hover:underline">
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
