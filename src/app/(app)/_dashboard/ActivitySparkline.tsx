import type { ActivityBucket } from "@/lib/dashboard-activity";
import { shiftDay, type DayScope } from "@/lib/day-scope";

// Geometry in the SVG's own units; the element scales to the card's width.
const W = 600;
const H = 48;
// Room for the 2px stroke and the peak dot, so neither is clipped at the edges.
const PAD = 4;

/** Every bucket the window covers, zeros included. A day with no writes is a
 *  ZERO in this series — leaving it out would draw the line straight through a
 *  quiet day as though it never happened. */
function fill(scope: DayScope, rows: ActivityBucket[]): ActivityBucket[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, r.n]));
  const keys: string[] = [];
  if (scope.range === "day") {
    for (let h = 0; h < 24; h += 1) {
      keys.push(`${scope.date} ${String(h).padStart(2, "0")}`);
    }
  } else {
    const days = scope.range === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i -= 1) keys.push(shiftDay(scope.date, -i));
  }
  return keys.map((bucket) => ({ bucket, n: byBucket.get(bucket) ?? 0 }));
}

/** "12 Sept" from a `YYYY-MM-DD` bucket, "14:00" from a `YYYY-MM-DD HH` one. */
function bucketLabel(bucket: string, hourly: boolean): string {
  if (hourly) return `${bucket.slice(11, 13)}:00`;
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * The window's writes as a curve, above the digest that says what they were.
 *
 * One series, so no legend — the panel title names it. The area is anchored at
 * zero (a sparkline with a floating baseline exaggerates every wiggle), the
 * peak is the only labelled point, and the ends of the window are the only
 * axis ticks: at 30 points a date under each one is unreadable, and the digest
 * below already carries the exact numbers.
 *
 * Server-rendered: it is a picture of data that arrived with the page, so it
 * needs no client bundle. Hover detail is a native `<title>` per bucket —
 * the same thing the delivery tile does with its bars.
 */
export default function ActivitySparkline({
  scope,
  rows,
}: {
  scope: DayScope;
  rows: ActivityBucket[];
}) {
  const series = fill(scope, rows);
  const total = series.reduce((s, b) => s + b.n, 0);
  if (total === 0 || series.length < 2) return null;

  const hourly = scope.range === "day";
  const peak = Math.max(...series.map((b) => b.n));
  const peakIndex = series.findIndex((b) => b.n === peak);
  const step = (W - PAD * 2) / (series.length - 1);
  const x = (i: number) => PAD + i * step;
  // Zero sits on the baseline; the peak stops PAD short of the top.
  const y = (n: number) => H - PAD - (n / peak) * (H - PAD * 2);

  const line = series.map((b, i) => `${x(i)},${y(b.n)}`).join(" ");
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;

  return (
    <div className="activity-sparkline mb-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${total} writes over ${series.length} ${hourly ? "hours" : "days"}, peaking at ${peak}`}
        className="activity-sparkline__svg block h-12 w-full text-slate-900"
      >
        {/* Baseline: the zero the area is measured from, drawn recessive so it
            reads as the floor and not as data. currentColor at 15%, not a slate
            stroke: the dark-mode shim in globals.css remaps `border-*` and
            `bg-*`, never `stroke-*`, so a fixed light grey would have stayed
            light — a bright hairline on a dark card. */}
        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="activity-sparkline__base opacity-15"
        />
        <polyline
          points={area}
          fill="currentColor"
          className="activity-sparkline__area opacity-10"
        />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="activity-sparkline__line"
        />
        <circle
          cx={x(peakIndex)}
          cy={y(peak)}
          r={3}
          fill="currentColor"
          className="activity-sparkline__peak"
          vectorEffect="non-scaling-stroke"
        />
        {/* Hit targets: one full-height column per bucket, wider than the mark
            it stands for, so the tooltip is reachable anywhere above the day
            rather than only on the 2px line. */}
        {series.map((b, i) => (
          <rect
            key={b.bucket}
            x={x(i) - step / 2}
            y={0}
            width={step}
            height={H}
            fill="transparent"
            className="activity-sparkline__hit"
          >
            <title>{`${bucketLabel(b.bucket, hourly)}: ${b.n} write${b.n === 1 ? "" : "s"}`}</title>
          </rect>
        ))}
      </svg>
      <div className="activity-sparkline__axis mt-0.5 flex justify-between text-[10px] text-slate-400">
        <span>{bucketLabel(series[0]!.bucket, hourly)}</span>
        {/* The only number on the plot: which bucket was the busiest, and how
            busy. A label on every point is noise at this size. */}
        <span className="activity-sparkline__peak-label text-slate-500">
          peak {peak} · {bucketLabel(series[peakIndex]!.bucket, hourly)}
        </span>
        <span>{bucketLabel(series[series.length - 1]!.bucket, hourly)}</span>
      </div>
    </div>
  );
}
