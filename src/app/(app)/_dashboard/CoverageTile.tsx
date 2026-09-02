import Link from "next/link";
import {
  compactNumber,
  monthLabel,
  type DeliveryMonth,
} from "@/lib/dashboard-monitoring";

/**
 * How much of the reported delivery the matrix can actually account for: the
 * share of impressions whose row the importer linked to an MC.
 *
 * The number is actionable in one place — the keyword→product rules under
 * Settings → Structure → Monitoring — which is why it earns a tile instead of
 * living in the monitoring table. Unmatched volume is mostly publisher lines
 * (telex, hvg, centralmedia…) that never carried a PMMID.
 *
 * Monthly, like its neighbour: it does not follow the day scope.
 */
export default function CoverageTile({ months }: { months: DeliveryMonth[] }) {
  const latest = months.length > 0 ? months[months.length - 1] : null;

  if (!latest || latest.impressions === 0) {
    return (
      <div className="signal-tile coverage-tile block rounded-xl border border-slate-200 bg-white p-4">
        <p className="signal-tile__label text-[10px] uppercase tracking-wider text-slate-500">
          Matrix coverage
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

  const share = latest.matchedImpressions / latest.impressions;
  // Below half the reported delivery unexplained is a mapping gap worth acting
  // on, not a reading of the campaign.
  const low = share < 0.5;

  return (
    <Link
      href="/monitoring"
      className="signal-tile coverage-tile block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400"
    >
      <p className="signal-tile__label text-[10px] uppercase tracking-wider text-slate-500">
        Matrix coverage
      </p>
      <p
        className={`signal-tile__value mt-1 text-2xl font-semibold ${
          low ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {Math.round(share * 100)}%
      </p>
      <p className="signal-tile__hint mt-0.5 text-xs text-slate-500">
        {compactNumber(latest.matchedImpressions)} of{" "}
        {compactNumber(latest.impressions)} impressions linked to an MC ·{" "}
        {monthLabel(latest.periodFrom)}
      </p>
      {/* Same bar grammar as the delivery tile next to it, so the row reads as
          one chart language. Fixed 0-100% scale here — a share is only
          meaningful against the whole, not against the best month. */}
      <div className="coverage-tile__chart mt-3 flex h-10 items-end gap-1">
        {months.map((m, i) => {
          const pct =
            m.impressions > 0 ? (m.matchedImpressions / m.impressions) * 100 : 0;
          const current = i === months.length - 1;
          return (
            <div
              key={m.periodFrom}
              title={`${monthLabel(m.periodFrom)}: ${Math.round(pct)}% linked`}
              className={`coverage-tile__bar flex-1 rounded-sm ${
                current
                  ? `coverage-tile__bar--current ${low ? "bg-amber-500" : "bg-emerald-500"}`
                  : "bg-slate-200"
              }`}
              // Data-driven height — a floor of 6% keeps an empty month visible.
              style={{ height: `${Math.max(6, pct)}%` }}
            />
          );
        })}
      </div>
      <div className="coverage-tile__axis mt-1 flex gap-1 text-[10px] text-slate-400">
        {months.map((m) => (
          <span key={m.periodFrom} className="flex-1 text-center">
            {monthLabel(m.periodFrom, true)}
          </span>
        ))}
      </div>
    </Link>
  );
}
