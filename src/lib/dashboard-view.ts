import { todayUtc, shiftDay, type ScopeRange } from "@/lib/day-scope";

/**
 * The dashboard's remembered view.
 *
 * Stored in a cookie rather than localStorage because the dashboard is a server
 * component whose whole state is the URL: the server has to know the remembered
 * view before it renders, or restoring it would mean a flash of the default
 * dashboard followed by a client-side rewrite.
 *
 * What is remembered is the CHOSEN VIEW, not a frozen date. "Yesterday" comes
 * back as yesterday-relative-to-now, not as the specific day it meant last
 * week — and a day reached with the arrow keys comes back as plain "today",
 * because reopening the dashboard on a stale day looks like an outage.
 */
export const DASHBOARD_VIEW_COOKIE = "mm6_dashboard_view";

export type DashboardView = {
  range: ScopeRange;
  /** Whole days back from today. Only 0 or 1 — the Today / Yesterday pills. */
  back: 0 | 1;
  products: string[];
  /** Creative strip ordering, "time" or "ctr". */
  sort: string;
};

export const DEFAULT_VIEW: DashboardView = {
  range: "day",
  back: 0,
  products: [],
  sort: "time",
};

export function isDefaultView(v: DashboardView): boolean {
  return (
    v.range === DEFAULT_VIEW.range &&
    v.back === DEFAULT_VIEW.back &&
    v.products.length === 0 &&
    v.sort === DEFAULT_VIEW.sort
  );
}

/** Serialize to the cookie value — a query string, so it stays readable. */
export function encodeView(v: DashboardView): string {
  const p = new URLSearchParams({ r: v.range, back: String(v.back) });
  if (v.products.length > 0) p.set("p", v.products.join(","));
  if (v.sort !== "time") p.set("cs", v.sort);
  return p.toString();
}

/** Parse a cookie value back. Returns null for anything unrecognizable. */
export function decodeView(raw: string | undefined): DashboardView | null {
  if (!raw) return null;
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const r = p.get("r");
  if (r !== "day" && r !== "7d" && r !== "30d") return null;
  return {
    range: r,
    back: p.get("back") === "1" ? 1 : 0,
    products: (p.get("p") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    sort: p.get("cs") === "ctr" ? "ctr" : "time",
  };
}

/** The dashboard URL a remembered view resolves to, anchored on today. */
export function viewHref(v: DashboardView, now: Date = new Date()): string {
  const today = todayUtc(now);
  const p = new URLSearchParams({
    d: v.range === "day" && v.back === 1 ? shiftDay(today, -1) : today,
    r: v.range,
  });
  if (v.products.length > 0) p.set("p", v.products.join(","));
  if (v.sort !== "time") p.set("cs", v.sort);
  return `/?${p.toString()}`;
}
