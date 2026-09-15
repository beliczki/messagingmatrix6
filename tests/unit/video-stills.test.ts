import { describe, expect, it } from "vitest";
import {
  MAX_STILLS,
  STILL_INTERVAL_SEC,
  planStills,
  stillTimestamp,
  wantsEndFrame,
} from "@/lib/still-strip";

describe("planStills", () => {
  it("gives a clip one tick per 5 seconds, tail included", () => {
    // 17s covers 0.1 / 5.1 / 10.1 / 15.1 — the partial last interval still
    // earns a frame, which is why the extraction uses `select` and not `fps`.
    expect(planStills(17)).toBe(4);
    expect(planStills(15)).toBe(3);
    expect(planStills(30)).toBe(6);
  });

  it("gives a clip shorter than one interval a single tick", () => {
    expect(planStills(0.5)).toBe(1);
    expect(planStills(5)).toBe(1);
  });

  it("caps a long clip instead of writing thousands of JPEGs", () => {
    expect(planStills(MAX_STILLS * STILL_INTERVAL_SEC)).toBe(MAX_STILLS);
    expect(planStills(10 * 60 * 60)).toBe(MAX_STILLS);
  });

  it("falls back to one tick when the duration is unknown", () => {
    expect(planStills(0)).toBe(1);
    expect(planStills(NaN)).toBe(1);
    expect(planStills(-3)).toBe(1);
  });
});

describe("wantsEndFrame", () => {
  it("adds the closing frame when the ticks stop well short of the end", () => {
    // The case that prompted it: a 10s clip ticks at 0.1 and 5.1 only, so the
    // branded end card was never in the strip. 2 ticks + end = 3 stills.
    expect(wantsEndFrame(10, planStills(10))).toBe(true);
    expect(planStills(10)).toBe(2);
    // 17s ticks at 0.1/5.1/10.1/15.1, still 1.9s shy of the end.
    expect(wantsEndFrame(17, planStills(17))).toBe(true);
  });

  it("skips it when the last tick already lands on the end", () => {
    // 15.2s ticks up to 15.1 — an end frame here would be a near-duplicate.
    expect(wantsEndFrame(15.2, planStills(15.2))).toBe(false);
    expect(wantsEndFrame(5.5, planStills(5.5))).toBe(false);
  });

  it("wants nothing when the duration is unknown", () => {
    expect(wantsEndFrame(0, 1)).toBe(false);
    expect(wantsEndFrame(NaN, 1)).toBe(false);
  });
});

describe("stillTimestamp", () => {
  const ticksOnly = { count: 4, intervalSec: 5, durationSec: 20, endFrame: false };
  const withEnd = { count: 3, intervalSec: 5, durationSec: 10, endFrame: true };

  it("maps a tick index to its position in the clip", () => {
    expect(stillTimestamp(0, ticksOnly)).toBe(0);
    expect(stillTimestamp(3, ticksOnly)).toBe(15);
  });

  it("reads the closing still as the end of the clip, not as a tick", () => {
    // Index 2 would be 10s by the interval and IS 10s here, but the point is
    // that it follows the duration: a 12s clip's end still reads 12, not 10.
    expect(stillTimestamp(2, withEnd)).toBe(10);
    expect(stillTimestamp(2, { ...withEnd, durationSec: 12 })).toBe(12);
    // The ticks before it are unaffected.
    expect(stillTimestamp(1, withEnd)).toBe(5);
  });
});
