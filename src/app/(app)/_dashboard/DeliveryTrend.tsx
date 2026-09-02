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
  if (months.length === 0) {
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

  const latest = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;
  const peak = Math.max(...months.map((m) => m.impressions));
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
      </p>
      <div className="delivery-trend__chart mt-3 flex h-10 items-end gap-1">
        {months.map((m, i) => (
          <div
            key={m.periodFrom}
            title={`${monthLabel(m.periodFrom)}: ${compactNumber(m.impressions)} impressions`}
            className={`delivery-trend__bar flex-1 rounded-sm ${
              i === months.length - 1
                ? "delivery-trend__bar--current bg-slate-800"
                : "bg-slate-200"
            }`}
            // Data-driven height — a floor of 6% keeps a near-empty month visible.
            style={{
              height: `${Math.max(6, peak > 0 ? (m.impressions / peak) * 100 : 0)}%`,
            }}
          />
        ))}
      </div>
      <div className="delivery-trend__axis mt-1 flex gap-1 text-[10px] text-slate-400">
        {months.map((m) => (
          <span key={m.periodFrom} className="flex-1 text-center">
            {monthLabel(m.periodFrom, true)}
          </span>
        ))}
      </div>
    </Link>
  );
}
