"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/app/_icons/Icon";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useBroadcastEvents } from "@/app/_components/broadcast-bus";
import AppDialog from "../_components/AppDialog";

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
 *
 * The panel carries the state and the two buttons only; WHICH MCs are missing
 * is a table, and a table belongs in a dialog, not in a 256px rail.
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
          <Icon name="spinner" className="size-4 animate-spin" />
        ) : (
          <Icon name="images" className="size-4" />
        )}
        {missing > 0 && !running ? (
          <span className="preview-health__dot absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-500" />
        ) : null}
      </button>
    );
  }

  return (
    <div className="preview-health">
      <div className="right-toolbar__section-title pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Previews
      </div>

      <div
        className={clsx(
          "preview-health__stat flex items-center gap-1 text-[11px]",
          missing > 0 ? "text-amber-700" : "text-slate-500",
        )}
        title={title}
      >
        {missing > 0 ? <Icon name="warning" className="size-3" /> : null}
        {missing > 0
          ? `${missing} MC${missing === 1 ? "" : "s"} missing`
          : "all up to date"}
        <span className="preview-health__scope ml-auto text-[10px] text-slate-400">
          {scope} in view
        </span>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running || scope === 0}
        className="preview-health__run toolbar-btn--primary mt-1.5 flex w-full items-center justify-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        title={title}
      >
        {running ? (
          <Icon name="spinner" className="size-3.5 animate-spin" />
        ) : (
          <Icon name="images" className="size-3.5" />
        )}
        Generate previews
      </button>

      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="preview-health__details toolbar-btn mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
      >
        <Icon name="list" className="size-3.5" />
        Details
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

      <PreviewHealthDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        status={status}
        scope={scope}
        running={running}
        onRun={run}
      />
    </div>
  );
}

/** The missing-preview table, in the Feed export dialog's shape: the primary
 *  action in the header, the list in the body. */
function PreviewHealthDialog({
  open,
  onClose,
  status,
  scope,
  running,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  status: PreviewStatus | undefined;
  scope: number;
  running: boolean;
  onRun: () => void;
}) {
  const offenders = status?.offenders ?? [];
  return (
    <AppDialog open={open} onClose={onClose} ariaLabel="Preview health">
      <div className="preview-health-dialog flex h-full flex-col overflow-hidden">
        <header className="preview-health-dialog__header toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 pr-14">
          <h2 className="text-base font-semibold text-slate-900">
            Previews ·{" "}
            <span className="font-mono text-sm">
              {status?.mcCount ?? 0} MC missing
            </span>
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
              <Icon name="images" className="size-4" />
            )}
            {running ? "Generating…" : `Generate previews (${scope})`}
          </button>
        </header>

        <div className="preview-health-dialog__body flex-1 overflow-auto px-6 py-4">
          <p className="preview-health-dialog__hint mb-3 text-xs text-slate-500">
            The count is client-wide; Generate shoots the {scope} MC
            {scope === 1 ? "" : "s"} in the current filtered view. Clear the
            filters to widen the run.{" "}
            {status
              ? `${status.freshCount} size preview${status.freshCount === 1 ? "" : "s"} are up to date, ${status.staleCount} missing or outdated.`
              : null}
          </p>
          {offenders.length === 0 ? (
            <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Every html MC has an up-to-date preview.
            </div>
          ) : (
            <table className="preview-health-dialog__table w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">MC</th>
                  <th className="py-1.5 font-medium">Missing sizes</th>
                </tr>
              </thead>
              <tbody>
                {offenders.map((o) => (
                  <tr
                    key={o.mcLabel}
                    className="preview-health-dialog__row border-b border-slate-100"
                  >
                    <td className="py-1.5 pr-3 font-mono text-xs text-slate-700">
                      {o.mcLabel}
                    </td>
                    <td className="py-1.5 text-xs text-slate-500">
                      {o.sizes.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
