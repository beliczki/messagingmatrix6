"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Images, Loader2 } from "lucide-react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useBroadcastEvents } from "@/app/_components/broadcast-bus";

// The route caps a call at 20 message ids, and one call shoots serially in the
// server's single Chromium — so a chunk is also the unit the run can be stopped
// at. Closing the tab between chunks ends the run; nothing is left half-written,
// because each shot persists its own PNG.
const CHUNK = 20;

export type PreviewStatus = {
  staleCount: number;
  freshCount: number;
  mcCount: number;
  offenders: { mcLabel: string; sizes: string[] }[];
};

type Progress = { done: number; failed: number; current: string | null };

/**
 * Which html MCs are missing an up-to-date preview PNG, and the button that
 * shoots them — server-side, in the box's own headless Chromium.
 *
 * The COUNT is client-wide (that is the honest warning: this is how much is
 * missing), but the RUN is scoped to the MCs in the current filtered view, the
 * way the Drive link check is scoped to the creatives in view. Clearing the
 * filters is what widens it to everything.
 */
export default function PreviewHealth({
  status,
  messageIds,
  collapsed = false,
}: {
  status: PreviewStatus | undefined;
  /** Message ids of the matrix items in the current filtered view. */
  messageIds: number[];
  collapsed?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const qc = useQueryClient();

  // Live from the server's own shoot loop: which MC and size is in Chromium
  // right now. Counting client-side keeps the total honest across chunks —
  // the server only knows about the chunk it was handed.
  const onShot = useCallback(
    (e: { detail?: unknown }) => {
      if (!runningRef.current) return;
      const d = e.detail as
        | { mcLabel?: string; size?: string; ok?: boolean }
        | undefined;
      if (!d) return;
      setProgress((p) => ({
        done: (p?.done ?? 0) + 1,
        failed: (p?.failed ?? 0) + (d.ok === false ? 1 : 0),
        current: d.mcLabel ? `${d.mcLabel} ${d.size ?? ""}`.trim() : null,
      }));
    },
    [],
  );
  useBroadcastEvents("preview_progress", onShot);

  async function run() {
    if (running || messageIds.length === 0) return;
    setRunning(true);
    runningRef.current = true;
    setError(null);
    setProgress({ done: 0, failed: 0, current: null });
    try {
      for (let i = 0; i < messageIds.length; i += CHUNK) {
        const r = await fetch("/api/previews/generate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_ids: messageIds.slice(i, i + CHUNK) }),
        });
        if (!r.ok) throw new Error(await r.text());
        await r.json();
      }
      qc.invalidateQueries({ queryKey: ["previews", "status"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress((p) => (p ? { ...p, current: null } : null));
    }
  }

  const missing = status?.mcCount ?? 0;
  const scope = messageIds.length;
  const title = missing
    ? `${status!.staleCount} size preview(s) across ${missing} MC(s) are missing or outdated. Generate shoots the ${scope} MC(s) in the current view on the server.`
    : "Every html MC has an up-to-date preview.";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={run}
        disabled={running || scope === 0}
        title={title}
        aria-label={title}
        className="preview-health preview-health--collapsed relative flex size-9 items-center justify-center rounded-md text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
      >
        {running ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Images className="size-4" />
        )}
        {missing > 0 && !running ? (
          <span className="preview-health__dot absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" />
        ) : null}
      </button>
    );
  }

  return (
    <div className="preview-health">
      <button
        type="button"
        onClick={run}
        disabled={running || scope === 0}
        className={clsx(
          "preview-health__run toolbar-btn flex w-full items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50",
          (running || scope === 0) && "opacity-50",
        )}
        title={title}
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Images className="size-3.5" />
        )}
        Generate previews
        <span className="preview-health__scope ml-auto text-[10px] text-slate-400">
          {scope}
        </span>
      </button>

      {running || progress ? (
        <div className="preview-health__progress mt-1 text-[10px] text-slate-500">
          <span className="tabular-nums text-slate-700">{progress?.done ?? 0}</span>
          {" shot"}
          {progress?.failed ? (
            <span className="preview-health__failed text-red-600">
              {" · "}
              {progress.failed} failed
            </span>
          ) : null}
          {progress?.current ? (
            <div className="preview-health__current truncate font-mono text-slate-400">
              {progress.current}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="preview-health__error mt-1 text-[10px] text-red-600">
          {error}
        </div>
      ) : null}

      {missing > 0 ? (
        <div className="preview-health__missing mt-1.5">
          <div className="preview-health__missing-head flex items-center gap-1 text-[10px] font-medium text-amber-700">
            <AlertTriangle className="size-3" />
            {missing} MC{missing === 1 ? "" : "s"} missing previews
          </div>
          <div className="preview-health__missing-list mt-1 max-h-40 overflow-auto">
            {status!.offenders.map((o) => (
              <div
                key={o.mcLabel}
                className="preview-health__missing-row flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-[10px] hover:bg-slate-100"
              >
                <span className="truncate font-mono text-slate-600">
                  {o.mcLabel}
                </span>
                <span className="shrink-0 text-slate-400">
                  {o.sizes.join(", ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
