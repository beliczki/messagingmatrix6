"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import GoogleDriveIcon from "@/app/_components/GoogleDriveIcon";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";

// Chunked so one stuck folder cannot hold up the whole run, and so the route's
// id cap is never the client's problem.
const CHUNK = 100;

type Counts = {
  resolved: number;
  unchanged: number;
  no_folder: number;
  folder_unreachable: number;
  file_not_found: number;
  ambiguous: number;
};

const EMPTY: Counts = {
  resolved: 0,
  unchanged: 0,
  no_folder: 0,
  folder_unreachable: 0,
  file_not_found: 0,
  ambiguous: 0,
};

const LINES: Array<[keyof Counts, string]> = [
  ["resolved", "resolved"],
  ["unchanged", "unchanged"],
  ["folder_unreachable", "folder unreachable"],
  ["file_not_found", "file not in folder"],
  ["ambiguous", "ambiguous name"],
  ["no_folder", "no folder link"],
];

/** Resolve (or re-verify) the direct Drive file link of every creative in the
 *  current filtered view. Reports the folders it could not open separately from
 *  the files it could not find — an unreachable folder means the link is not
 *  shared "anyone with the link", and would show a share viewer a request-access
 *  page rather than the creative. */
export default function DriveHealthCheck({
  creativeIds,
  collapsed = false,
}: {
  creativeIds: number[];
  collapsed?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function run() {
    if (running || creativeIds.length === 0) return;
    setRunning(true);
    setError(null);
    setCounts(null);
    const total: Counts = { ...EMPTY };
    try {
      for (let i = 0; i < creativeIds.length; i += CHUNK) {
        const r = await fetch("/api/creatives/drive-resolve", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creativeIds: creativeIds.slice(i, i + CHUNK) }),
        });
        if (!r.ok) throw new Error(await r.text());
        const body = (await r.json()) as { counts: Counts };
        for (const k of Object.keys(total) as (keyof Counts)[]) {
          total[k] += body.counts[k] ?? 0;
        }
        setCounts({ ...total });
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
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleDriveIcon className="size-4" />
        )}
      </button>
    );
  }

  return (
    <div className="drive-health">
      <button
        type="button"
        onClick={run}
        disabled={running || creativeIds.length === 0}
        className={clsx(
          "drive-health__run toolbar-btn flex w-full items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50",
          (running || creativeIds.length === 0) && "opacity-50",
        )}
        title={title}
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <GoogleDriveIcon className="size-3.5" />
        )}
        Drive link check
        <span className="drive-health__scope ml-auto text-[10px] text-slate-400">
          {creativeIds.length}
        </span>
      </button>
      {error ? (
        <div className="drive-health__error mt-1 text-[10px] text-red-600">{error}</div>
      ) : null}
      {counts ? (
        <dl className="drive-health__report mt-1 space-y-0.5 text-[10px] text-slate-500">
          {LINES.filter(([k]) => counts[k] > 0).map(([k, label]) => (
            <div key={k} className="drive-health__line flex justify-between gap-2">
              <dt>{label}</dt>
              <dd className="tabular-nums text-slate-700">{counts[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
