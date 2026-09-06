"use client";

import { AlertTriangle } from "lucide-react";
import ToggleBtn from "../../_components/ToggleBtn";
import type { SankeyMetric } from "../_tree/buildSankey";
import { formatMetric, periodLabel, useMessageMetrics } from "./useMessageMetrics";

// What the sankey's ribbon widths mean, and — for the delivery metrics — how
// much of the period the diagram can actually account for.
//
// The coverage line is not decoration. Only monitoring rows the importer could
// tie to a matrix message can be drawn on the matrix's own structure; the rest
// is real spend and real delivery that this diagram has no place to put. On the
// live Erste August report that is 87% of the cost, so a weighted sankey that
// stayed silent about it would read as "this is where the money went" while
// showing an eighth of it.
export default function SankeyMetricPanel({
  metric,
  setMetric,
  period,
  setPeriod,
}: {
  metric: SankeyMetric;
  setMetric: (m: SankeyMetric) => void;
  period: string | null;
  setPeriod: (p: string | null) => void;
}) {
  const metricsQ = useMessageMetrics(period, metric !== "messages");
  const data = metricsQ.data;
  const coverage = data?.coverage[metric === "cost" ? "cost" : "impressions"];
  const share =
    coverage && coverage.total > 0
      ? Math.round((coverage.matched / coverage.total) * 100)
      : null;

  return (
    <div className="sankey-metric-panel rounded-md border border-slate-200 bg-white p-3">
      <div className="sankey-metric-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Weight by
      </div>

      <div className="toggle-group sankey-metric-panel__switch mt-2 flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        <ToggleBtn
          active={metric === "messages"}
          onClick={() => setMetric("messages")}
          title="Ribbon width = MC placements — a card put out in 24 audiences counts 24"
        >
          MC
        </ToggleBtn>
        <ToggleBtn
          active={metric === "impressions"}
          onClick={() => setMetric("impressions")}
          title="Ribbon width = impressions delivered"
        >
          Impr.
        </ToggleBtn>
        <ToggleBtn
          active={metric === "cost"}
          onClick={() => setMetric("cost")}
          title="Ribbon width = cost"
        >
          Cost
        </ToggleBtn>
      </div>

      {metric === "messages" ? (
        <p className="sankey-metric-panel__hint mt-2 text-[10px] leading-snug text-slate-500">
          Structure only — no report involved. Width counts{" "}
          <strong>placements</strong>: one card put out in 24 audiences weighs
          24, not 1.
        </p>
      ) : metricsQ.isLoading ? (
        <p className="sankey-metric-panel__hint mt-2 text-[10px] text-slate-500">
          Loading delivery…
        </p>
      ) : !data || data.periods.length === 0 ? (
        <p className="sankey-metric-panel__hint mt-2 text-[10px] leading-snug text-slate-500">
          No monitoring data imported yet.
        </p>
      ) : (
        <>
          <label className="form-field sankey-metric-panel__period mt-2 block">
            <span className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Report period
            </span>
            <select
              value={data.period ?? ""}
              onChange={(e) => setPeriod(e.target.value)}
              className="input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
            >
              {data.periods.map((p) => (
                <option key={p.periodFrom} value={p.periodFrom}>
                  {periodLabel(p.periodFrom)}
                </option>
              ))}
            </select>
          </label>

          {share !== null ? (
            <div
              className={
                share >= 70
                  ? "sankey-metric-panel__coverage mt-2 rounded bg-slate-50 px-2 py-1.5 text-[10px] leading-snug text-slate-600"
                  : "sankey-metric-panel__coverage sankey-metric-panel__coverage--low mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800"
              }
            >
              <div className="flex items-start gap-1.5">
                {share < 70 ? (
                  <AlertTriangle className="mt-0.5 size-3 flex-shrink-0" />
                ) : null}
                <span>
                  <strong>{share}%</strong> of this period&apos;s{" "}
                  {metric === "cost" ? "cost" : "impressions"} is tied to a
                  message and drawn here —{" "}
                  {formatMetric(coverage!.matched, metric, true)} of{" "}
                  {formatMetric(coverage!.total, metric, true)}. The rest carries
                  no MC in the report, so the matrix has nowhere to put it.
                </span>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
