// Dashboard day scope. Every timestamp in the DB is a UTC string in
// `YYYY-MM-DD HH:MM:SS` form (see `nowUtc` in db/schema.ts), so the scope is a
// UTC day and its bounds are plain string comparisons — the same comparison
// the stored format is already ordered by.

export type ScopeRange = "day" | "7d";

export type DayScope = {
  /** Anchor day, `YYYY-MM-DD` (UTC). The range always ends on this day. */
  date: string;
  range: ScopeRange;
  /** Inclusive lower bound, `YYYY-MM-DD 00:00:00`. */
  from: string;
  /** Inclusive upper bound, `YYYY-MM-DD 23:59:59`. */
  to: string;
  /** Human label for the header ("Today", "Yesterday", "1 Sep – 7 Sep"). */
  label: string;
};

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in UTC, `YYYY-MM-DD`. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Shift a `YYYY-MM-DD` day by whole days (negative = earlier). */
export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function prettyDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Resolve the `?d=` / `?r=` query pair into a scope. Anything unparseable —
 * a malformed date, an unknown range, a day in the future — falls back to
 * today, so a hand-typed URL cannot produce an empty dashboard that looks
 * like "nothing happened".
 */
export function resolveDayScope(
  d: string | undefined,
  r: string | undefined,
  now: Date = new Date(),
): DayScope {
  const today = todayUtc(now);
  const date =
    d && DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d <= today
      ? d
      : today;
  const range: ScopeRange = r === "7d" ? "7d" : "day";
  const start = range === "7d" ? shiftDay(date, -6) : date;

  let label: string;
  if (range === "7d") {
    label = `${prettyDay(start)} – ${prettyDay(date)}`;
  } else if (date === today) {
    label = "Today";
  } else if (date === shiftDay(today, -1)) {
    label = "Yesterday";
  } else {
    label = prettyDay(date);
  }

  return { date, range, from: `${start} 00:00:00`, to: `${date} 23:59:59`, label };
}

/** Whole days between two `YYYY-MM-DD HH:MM:SS` UTC stamps (floored). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}
