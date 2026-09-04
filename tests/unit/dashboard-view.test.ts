import { describe, it, expect } from "vitest";
import {
  DEFAULT_VIEW,
  decodeView,
  encodeView,
  isDefaultView,
  viewHref,
  type DashboardView,
} from "@/lib/dashboard-view";

const NOW = new Date("2026-09-04T08:00:00Z");

describe("dashboard view memory", () => {
  it("round-trips a chosen view", () => {
    const v: DashboardView = {
      range: "30d",
      back: 0,
      products: ["SZK", "HK"],
      sort: "ctr",
    };
    expect(decodeView(encodeView(v))).toEqual(v);
  });

  it("round-trips the Yesterday pill", () => {
    const v: DashboardView = { range: "day", back: 1, products: [], sort: "time" };
    expect(decodeView(encodeView(v))).toEqual(v);
  });

  it("rejects a cookie it does not recognize instead of guessing", () => {
    expect(decodeView(undefined)).toBeNull();
    expect(decodeView("")).toBeNull();
    expect(decodeView("r=90d")).toBeNull(); // not a range we serve
    expect(decodeView("nonsense")).toBeNull();
  });

  it("anchors a restored view on today, never on the stored day", () => {
    // The point of storing the pill rather than the date: reopening the
    // dashboard a week later must not land on a stale, empty day.
    expect(viewHref({ range: "7d", back: 0, products: [], sort: "time" }, NOW)).toBe(
      "/?d=2026-09-04&r=7d",
    );
    expect(viewHref({ range: "day", back: 1, products: [], sort: "time" }, NOW)).toBe(
      "/?d=2026-09-03&r=day",
    );
  });

  it("carries the product filter and strip ordering into the URL", () => {
    expect(
      viewHref({ range: "day", back: 0, products: ["SZK"], sort: "ctr" }, NOW),
    ).toBe("/?d=2026-09-04&r=day&p=SZK&cs=ctr");
  });

  it("knows the default view, which is not worth restoring", () => {
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(isDefaultView(decodeView(encodeView(DEFAULT_VIEW))!)).toBe(true);
    expect(
      isDefaultView({ range: "day", back: 0, products: ["SZK"], sort: "time" }),
    ).toBe(false);
    expect(
      isDefaultView({ range: "7d", back: 0, products: [], sort: "time" }),
    ).toBe(false);
  });
});
