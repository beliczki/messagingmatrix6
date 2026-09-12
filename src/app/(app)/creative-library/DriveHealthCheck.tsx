"use client";

import { useState } from "react";
import { Icon } from "@/app/_icons/Icon";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import AppDialog from "../_components/AppDialog";

// Chunked so one stuck folder cannot hold up the whole run, and so the route's
// id cap is never the client's problem.
const CHUNK = 100;

type Outcome =
  | "resolved"
  | "unchanged"
  | "no_folder"
  | "folder_unreachable"
  | "file_not_found"
  | "ambiguous";

type Counts = Record<Outcome, number>;

type Result = {
  creativeId: number;
  fileName: string | null;
  folderName: string | null;
  outcome: Outcome;
};

/** What the current view holds, as far as Drive links go. */
export type DriveCreative = {
  id: number;
  fileName: string | null;
  driveFolderId: string | null;
  driveFileId: string | null;
};

const EMPTY: Counts = {
  resolved: 0,
  unchanged: 0,
  no_folder: 0,
  folder_unreachable: 0,
  file_not_found: 0,
  ambiguous: 0,
};

const LINES: Array<[Outcome, string]> = [
  ["resolved", "resolved"],
  ["unchanged", "unchanged"],
  ["folder_unreachable", "folder unreachable"],
  ["file_not_found", "file not in folder"],
  ["ambiguous", "ambiguous name"],
  ["no_folder", "no folder link"],
];

const OUTCOME_LABEL: Record<Outcome, string> = Object.fromEntries(
  LINES,
) as Record<Outcome, string>;

/** Outcomes a run leaves behind as a problem to act on. */
const BAD: Outcome[] = ["folder_unreachable", "file_not_found", "ambiguous"];

/** Resolve (or re-verify) the direct Drive file link of every creative in the
 *  current filtered view. Reports the folders it could not open separately from
 *  the files it could not find — an unreachable folder means the link is not
 *  shared "anyone with the link", and would show a share viewer a request-access
 *  page rather than the creative.
 *
 *  The panel carries the state and the two buttons; the per-file breakdown is a
 *  table and lives in the dialog. */
export default function DriveHealthCheck({
  creatives,
  collapsed = false,
}: {
  creatives: DriveCreative[];
  collapsed?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const qc = useQueryClient();

  const creativeIds = creatives.map((c) => c.id);
  const unresolved = creatives.filter((c) => c.driveFileId === null);

  async function run() {
    if (running || creativeIds.length === 0) return;
    setRunning(true);
    setError(null);
    setCounts(null);
    setResults([]);
    const total: Counts = { ...EMPTY };
    const all: Result[] = [];
    try {
      for (let i = 0; i < creativeIds.length; i += CHUNK) {
        const r = await fetch("/api/creatives/drive-resolve", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creativeIds: creativeIds.slice(i, i + CHUNK) }),
        });
        if (!r.ok) throw new Error(await r.text());
        const body = (await r.json()) as { counts: Counts; results?: Result[] };
        for (const k of Object.keys(total) as Outcome[]) {
          total[k] += body.counts[k] ?? 0;
        }
        all.push(...(body.results ?? []));
        setCounts({ ...total });
        setResults([...all]);
      }
      qc.invalidateQueries({ queryKey: ["creatives"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const title = `Drive link health check (${creativeIds.length})`;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={running || creativeIds.length === 0}
        title={title}
        aria-label={title}
        className="drive-health drive-health--collapsed flex size-9 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
      >
        {running ? (
          <Icon name="spinner" className="size-4 animate-spin" />
        ) : (
          <Icon name="google-drive" className="size-4" />
        )}
      </button>
    );
  }

  const problems = results.filter((r) => BAD.includes(r.outcome));

  return (
    // Boxed like the matrix's Edit mode and Export panels — same rule, same
    // padding, same uppercase title, and the primary action at the bottom.
    <div className="drive-health rounded-md border border-slate-200 bg-white p-3">
      <div className="drive-health__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Drive links
      </div>

      <div
        className={clsx(
          "drive-health__stat mt-1 flex items-center gap-1 text-[11px]",
          unresolved.length > 0 ? "text-amber-700" : "text-slate-500",
        )}
        title={title}
      >
        {unresolved.length > 0 ? <Icon name="warning" className="size-3" /> : null}
        {unresolved.length > 0
          ? `${unresolved.length} without a file link`
          : "all linked"}
        <span className="drive-health__scope ml-auto text-[10px] text-slate-400">
          {creativeIds.length} in view
        </span>
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="drive-health__details toolbar-btn mt-2 flex w-full items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-100"
      >
        <Icon name="list" className="size-3" />
        Details
      </button>

      <button
        type="button"
        onClick={run}
        disabled={running || creativeIds.length === 0}
        className="drive-health__run toolbar-btn--primary mt-1.5 flex w-full items-center justify-center gap-1.5 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        title={title}
      >
        {running ? (
          <Icon name="spinner" className="size-3 animate-spin" />
        ) : (
          <Icon name="google-drive" className="size-3" />
        )}
        Run check
      </button>

      {error ? (
        <div className="drive-health__error mt-1 text-[10px] text-red-600">{error}</div>
      ) : null}

      <DriveHealthDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        counts={counts}
        problems={problems}
        unresolved={unresolved}
        scope={creativeIds.length}
        running={running}
        error={error}
        onRun={run}
      />
    </div>
  );
}

/** The run's breakdown, in the Feed export dialog's shape: the primary action
 *  in the header, the table in the body. Before the first run it shows what the
 *  current view already knows — which creatives carry no resolved file link. */
function DriveHealthDialog({
  open,
  onClose,
  counts,
  problems,
  unresolved,
  scope,
  running,
  error,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  counts: Counts | null;
  problems: Result[];
  unresolved: DriveCreative[];
  scope: number;
  running: boolean;
  error: string | null;
  onRun: () => void;
}) {
  return (
    <AppDialog open={open} onClose={onClose} ariaLabel="Drive link check">
      <div className="drive-health-dialog flex h-full flex-col overflow-hidden">
        <header className="drive-health-dialog__header toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 pr-14">
          <h2 className="text-base font-semibold text-slate-900">
            Drive links ·{" "}
            <span className="font-mono text-sm">{scope} in view</span>
          </h2>
          <button
            type="button"
            onClick={onRun}
            disabled={running || scope === 0}
            className="toolbar-btn--primary flex items-center gap-2 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {running ? (
              <Icon name="spinner" className="size-4 animate-spin" />
            ) : (
              <Icon name="google-drive" className="size-4" />
            )}
            {running ? "Checking…" : "Run check"}
          </button>
        </header>

        <div className="drive-health-dialog__body flex-1 overflow-auto px-6 py-4">
          <p className="drive-health-dialog__hint mb-3 text-xs text-slate-500">
            The check opens each creative&rsquo;s delivery folder and matches the
            file by name. An unreachable folder is a sharing problem, not a
            missing file: a share viewer would get a request-access page.
          </p>

          {error ? (
            <div className="drive-health-dialog__error mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          {counts ? (
            <dl className="drive-health-dialog__report mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {LINES.map(([k, label]) => (
                <div
                  key={k}
                  className="drive-health-dialog__line flex justify-between gap-2 border-b border-slate-100 py-1"
                >
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="tabular-nums font-medium text-slate-900">
                    {counts[k]}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {counts && problems.length > 0 ? (
            <table className="drive-health-dialog__table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">File</th>
                  <th className="py-1.5 pr-3 font-medium">Folder</th>
                  <th className="py-1.5 font-medium">Problem</th>
                </tr>
              </thead>
              <tbody>
                {problems.map((r) => (
                  <tr
                    key={r.creativeId}
                    className="drive-health-dialog__row border-b border-slate-100"
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">
                      {r.fileName ?? `#${r.creativeId}`}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-slate-500">
                      {r.folderName ?? "—"}
                    </td>
                    <td className="py-1.5 text-xs text-amber-700">
                      {OUTCOME_LABEL[r.outcome]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : counts ? (
            <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Every checked creative resolved to a Drive file.
            </div>
          ) : unresolved.length > 0 ? (
            <>
              <div className="drive-health-dialog__pending-head mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                No file link yet · {unresolved.length}
              </div>
              <table className="drive-health-dialog__table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">File</th>
                    <th className="py-1.5 font-medium">Folder link</th>
                  </tr>
                </thead>
                <tbody>
                  {unresolved.map((c) => (
                    <tr
                      key={c.id}
                      className="drive-health-dialog__row border-b border-slate-100"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">
                        {c.fileName ?? `#${c.id}`}
                      </td>
                      <td className="py-1.5 text-xs text-slate-500">
                        {c.driveFolderId ? "folder set" : "no folder link"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Every creative in view already carries a resolved Drive file link.
              Run the check to re-verify them.
            </div>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
