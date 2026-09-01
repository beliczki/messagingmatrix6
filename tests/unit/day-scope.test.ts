import { describe, it, expect } from "vitest";
import { resolveDayScope, shiftDay, daysBetween, todayUtc } from "@/lib/day-scope";

const NOW = new Date("2026-09-01T08:30:00Z");

describe("resolveDayScope", () => {
  it("defaults to today with a single-day range", () => {
    const s = resolveDayScope(undefined, undefined, NOW);
    expect(s.date).toBe("2026-09-01");
    expect(s.range).toBe("day");
    expect(s.from).toBe("2026-09-01 00:00:00");
    expect(s.to).toBe("2026-09-01 23:59:59");
    expect(s.label).toBe("Today");
  });

  it("labels the previous day 'Yesterday'", () => {
    expect(resolveDayScope("2026-08-31", "day", NOW).label).toBe("Yesterday");
  });

  it("spans seven days inclusive of the anchor day", () => {
    const s = resolveDayScope("2026-09-01", "7d", NOW);
    expect(s.from).toBe("2026-08-26 00:00:00");
    expect(s.to).toBe("2026-09-01 23:59:59");
  });

  // A hand-typed or stale URL must not produce an empty page that reads as
  // "nothing happened".
  it("falls back to today on garbage or future input", () => {
    expect(resolveDayScope("not-a-date", "day", NOW).date).toBe("2026-09-01");
    expect(resolveDayScope("2026-13-40", "day", NOW).date).toBe("2026-09-01");
    expect(resolveDayScope("2027-01-01", "day", NOW).date).toBe("2026-09-01");
    expect(resolveDayScope("2026-08-31", "week", NOW).range).toBe("day");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(resolveDayScope("2026-03-02", "7d", NOW).from).toBe("2026-02-24 00:00:00");
  });
});

describe("daysBetween", () => {
  it("counts whole days from a stored UTC stamp", () => {
    expect(daysBetween("2026-07-16 09:12:00", "2026-09-01")).toBe(47);
    expect(daysBetween("2026-09-01 23:59:59", "2026-09-01")).toBe(0);
  });
});

describe("todayUtc", () => {
  it("is the UTC calendar day, not the local one", () => {
    expect(todayUtc(new Date("2026-09-01T23:30:00Z"))).toBe("2026-09-01");
  });
});
