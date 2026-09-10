import Link from "next/link";
import {
  compactNumber,
  monthLabel,
  type DeliveryMonth,
} from "@/lib/dashboard-monitoring";

/**
 * Reported delivery over the last few report periods.
 *
 * Wears the `signal-tile` label/value/hint language of the row it sits in, and
 * says its own period out loud in the hint: unlike the panels below it, this
 * tile is monthly and does not follow the day scope.
 *
 * Bar heights are the one thing that cannot live in a class — they come from
 * the data — so they are the only inline style here.
 */
export default function DeliveryTrend({
  months,
}: {
  months: DeliveryMonth[];
}) {
  if (months.every((m) => !m.reported)) {
    return (
      <div className="signal-tile delivery-trend block rounded-xl border border-slate-200 bg-white p-4">
        <p className="signal-tile__label text-[10px] uppercase tracking-wider text-slate-500">
          Delivery
        </p>
        <p className="signal-tile__value mt-1 text-2xl font-semibold text-slate-400">
          —
        </p>
        <p className="signal-tile__hint mt-0.5 text-xs text-slate-500">
          no monitoring import yet
        </p>
      </div>
    );
  }

  // The headline is about the newest month that was actually MEASURED. Months
  // the series carries only to show the gap (reported: false) have zeros, and
  // reading a zero as this month's delivery is the misreport this tile exists
  // to avoid — so they rank no bar, set no peak and never become `latest`.
  const measured = months.filter((m) => m.reported);
  const latest = measured[measured.length - 1];
  const previous = measured.length > 1 ? measured[measured.length - 2] : null;
  const peak = Math.max(...measured.map((m) => m.impressions));
  const latestIndex = months.lastIndexOf(latest);
  // Newest month the series shows but reporting has not reached. Named in the
  // hint as well as drawn: the chart says "there is a gap", the sentence says
  // which month it is, and the value above is explicitly about an older one.
  const missing = months.filter((m) => !m.reported).at(-1) ?? null;
  const delta =
    previous && previous.impressions > 0
      ? (latest.impressions - previous.impressions) / previous.impressions
      : null;

  return (
    <Link
      href="/monitoring"
      className="signal-tile delivery-trend block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400"
    >
      <p className="signal-tile__label text-[10px] uppercase tracking-wider text-slate-500">
        Delivery
      </p>
      <p className="signal-tile__value mt-1 text-2xl font-semibold text-slate-900">
        {compactNumber(latest.impressions)}
        {delta !== null ? (
          <span
            className={`delivery-trend__delta ml-2 text-sm font-medium ${
              delta < 0 ? "text-amber-700" : "text-emerald-700"
            }`}
          >
            {delta >= 0 ? "+" : ""}
            {Math.round(delta * 100)}%
          </span>
        ) : null}
      </p>
      <p className="signal-tile__hint mt-0.5 text-xs text-slate-500">
        impressions · {monthLabel(latest.periodFrom)}
        {previous ? ` vs ${monthLabel(previous.periodFrom, true)}` : ""}
        {missing ? ` · no ${monthLabel(missing.periodFrom, true)} data yet` : ""}
      </p>
      <div className="delivery-trend__chart mt-3 flex h-10 items-end gap-1">
        {months.map((m, i) =>
          m.reported ? (
            <div
              key={m.periodFrom}
              title={`${monthLabel(m.periodFrom)}: ${compactNumber(m.impressions)} impressions`}
              className={`delivery-trend__bar flex-1 rounded-sm ${
                i === latestIndex
                  ? "delivery-trend__bar--current bg-slate-800"
                  : "bg-slate-200"
              }`}
              // Data-driven height — a floor of 6% keeps a near-empty month visible.
              style={{
                height: `${Math.max(6, peak > 0 ? (m.impressions / peak) * 100 : 0)}%`,
              }}
            />
          ) : (
            // Not a 6% stub: a short bar would read as "almost no delivery",
            // which is the opposite of "not measured yet". A dashed full-height
            // outline is empty by construction and cannot be misread as a value.
            <div
              key={m.periodFrom}
              title={`${monthLabel(m.periodFrom)}: not imported yet`}
              className="delivery-trend__bar delivery-trend__bar--missing h-full flex-1 rounded-sm border border-dashed border-slate-300"
            />
          ),
        )}
      </div>
      <div className="delivery-trend__axis mt-1 flex gap-1 text-[10px] text-slate-400">
        {months.map((m) => (
          <span
            key={m.periodFrom}
            className={`flex-1 text-center ${m.reported ? "" : "text-slate-300"}`}
          >
            {monthLabel(m.periodFrom, true)}
          </span>
        ))}
      </div>
    </Link>
  );
}
