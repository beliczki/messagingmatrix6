"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import {
  MatrixIframePreview,
  templateMetaFor,
} from "../../_components/MatrixIframeTile";
import type { MatrixNavItem } from "../../creative-library/MatrixDetailDialog";
import { periodDateKey } from "@/lib/period";

// Minimal row shape the dialog needs from the monitoring list.
export type DetailRow = {
  platform: string;
  size: string;
  audienceKey: string;
  mcNumber: number;
  mcVariant: string;
  impressions: number;
  clicks: number;
};

/** One report period's totals for this MC, from the range the table selected. */
export type TrendRow = {
  mcNumber: number;
  mcVariant: string;
  periodFrom: string;
  impressions: number;
  clicks: number;
};

type Preview = MatrixNavItem & {
  templateMeta?: ReturnType<typeof templateMetaFor>;
};

const fmt = (n: number) => n.toLocaleString();
const pct = (i: number, c: number) =>
  i > 0 ? `${((c / i) * 100).toFixed(2)}%` : "—";

export default function MonitoringDetailDialog({
  mc,
  messageName,
  messageStatus,
  preview,
  rows,
  trend,
  onClose,
}: {
  mc: { number: number; variant: string };
  messageName: string | null;
  messageStatus: string | null;
  preview?: Preview;
  rows: DetailRow[];
  trend: TrendRow[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Per (audience, size) breakdown for this MC, summed across platforms/topics.
  const breakdown = useMemo(() => {
    const mine = rows.filter(
      (r) => r.mcNumber === mc.number && r.mcVariant === mc.variant,
    );
    const byKey = new Map<
      string,
      { audience: string; size: string; impressions: number; clicks: number }
    >();
    for (const r of mine) {
      const k = `${r.audienceKey}|${r.size}`;
      const e =
        byKey.get(k) ??
        byKey
          .set(k, {
            audience: r.audienceKey,
            size: r.size,
            impressions: 0,
            clicks: 0,
          })
          .get(k)!;
      e.impressions += r.impressions;
      e.clicks += r.clicks;
    }
    return [...byKey.values()].sort((a, b) => b.impressions - a.impressions);
  }, [rows, mc.number, mc.variant]);

  // This MC month by month, oldest first. Only worth showing when the table's
  // range covers more than one period — with a single period it would just
  // restate the total below it.
  const byPeriod = useMemo(
    () =>
      trend
        .filter((r) => r.mcNumber === mc.number && r.mcVariant === mc.variant)
        .sort((a, b) =>
          (periodDateKey(a.periodFrom) ?? "").localeCompare(
            periodDateKey(b.periodFrom) ?? "",
          ),
        ),
    [trend, mc.number, mc.variant],
  );

  const totals = breakdown.reduce(
    (a, r) => ({
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
    }),
    { impressions: 0, clicks: 0 },
  );

  const matched = !!preview || messageName !== null;

  return (
    <div
      className="modal monitoring-detail fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__panel monitoring-detail__panel flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <header className="monitoring-detail__header flex items-center gap-3 border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            MC{mc.number}
            {mc.variant}
          </h2>
          {matched ? (
            <span className="text-sm text-slate-600">
              {messageName}
              {messageStatus ? (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                  {messageStatus}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="status-badge--unmatched rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
              unmatched
            </span>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="monitoring-detail__body flex flex-col gap-4 overflow-auto p-5 sm:flex-row">
          {/* preview (matched) or unmatched placeholder */}
          <div className="monitoring-detail__preview shrink-0">
            {preview ? (
              <div className="thumb-checker h-[250px] w-[300px] overflow-hidden rounded-md border border-slate-200">
                <MatrixIframePreview
                  message={preview.message}
                  templateName={preview.liveTemplateName}
                  size={preview.liveSize}
                  mode="fit-rect"
                  templateMeta={preview.templateMeta}
                />
              </div>
            ) : (
              <div className="flex h-[250px] w-[300px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                <span className="status-badge--unmatched rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-800">
                  unmatched
                </span>
                <span className="text-xs">no linked creative</span>
              </div>
            )}
          </div>

          <div className="monitoring-detail__tables flex min-w-0 flex-1 flex-col gap-4">
            {byPeriod.length > 1 ? (
              <div className="monitoring-detail__periods">
                <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                  By report period
                </h3>
                <table className="w-full table-auto border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-1.5 font-medium">Period</th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Impr.
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        Clicks
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium">
                        CTR
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPeriod.map((r) => (
                      <tr
                        key={r.periodFrom}
                        className="border-b border-slate-100"
                      >
                        <td className="px-2 py-1 font-mono text-xs text-slate-600">
                          {r.periodFrom.slice(0, 10)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-800">
                          {fmt(r.impressions)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-800">
                          {fmt(r.clicks)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                          {pct(r.impressions, r.clicks)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {/* per size × audience breakdown */}
            <div className="monitoring-detail__breakdown min-w-0 flex-1">
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                By audience &amp; size
              </h3>
              <table className="w-full table-auto border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-1.5 font-medium">Audience</th>
                    <th className="px-2 py-1.5 font-medium">Size</th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      Impr.
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">
                      Clicks
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((r) => (
                    <tr
                      key={`${r.audience}|${r.size}`}
                      className="border-b border-slate-100"
                    >
                      <td className="px-2 py-1 text-xs text-slate-600">
                        {r.audience}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-slate-600">
                        {r.size || "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-800">
                        {fmt(r.impressions)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-800">
                        {fmt(r.clicks)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {pct(r.impressions, r.clicks)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-300 font-semibold text-slate-900">
                    <td className="px-2 py-1.5 text-xs" colSpan={2}>
                      Total
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmt(totals.impressions)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {fmt(totals.clicks)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {pct(totals.impressions, totals.clicks)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
