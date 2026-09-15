import { describe, expect, it } from "vitest";
import {
  MAX_STILLS,
  STILL_INTERVAL_SEC,
  planStills,
  stillInterval,
  stillTimestamp,
  wantsEndFrame,
} from "@/lib/still-strip";

describe("stillInterval", () => {
  it("is one second for anything the cap can cover at that spacing", () => {
    expect(stillInterval(5)).toBe(STILL_INTERVAL_SEC);
    expect(stillInterval(30)).toBe(1);
    expect(stillInterval(MAX_STILLS)).toBe(1);
  });

  it("stretches past the cap so the strip still spans the whole clip", () => {
    // The alternative — keeping 1s and truncating — would leave the back half
    // of a long clip unreachable, with nothing on screen to say so.
    expect(stillInterval(90)).toBe(2);
    expect(stillInterval(180)).toBe(3);
    expect(stillInterval(600)).toBe(10);
  });

  it("falls back to the target spacing when the duration is unknown", () => {
    expect(stillInterval(0)).toBe(STILL_INTERVAL_SEC);
    expect(stillInterval(NaN)).toBe(STILL_INTERVAL_SEC);
  });
});

describe("planStills", () => {
  it("gives a clip one tick per second", () => {
    expect(planStills(10)).toBe(10);
    expect(planStills(30)).toBe(30);
  });

  it("never exceeds the cap, however long the clip", () => {
    expect(planStills(MAX_STILLS)).toBe(MAX_STILLS);
    expect(planStills(90)).toBeLessThanOrEqual(MAX_STILLS);
    expect(planStills(10 * 60 * 60)).toBeLessThanOrEqual(MAX_STILLS);
  });

  it("gives a clip shorter than one interval a single tick", () => {
    expect(planStills(0.5)).toBe(1);
  });

  it("falls back to one tick when the duration is unknown", () => {
    expect(planStills(0)).toBe(1);
    expect(planStills(NaN)).toBe(1);
    expect(planStills(-3)).toBe(1);
  });
});

describe("wantsEndFrame", () => {
  it("adds the closing frame when the ticks stop short of the end", () => {
    // A 10s clip ticks 0.1 … 9.1, so the branded end card is still 0.9s away.
    expect(wantsEndFrame(10, planStills(10))).toBe(true);
    expect(wantsEndFrame(30, planStills(30))).toBe(true);
  });

  it("skips it when the last tick already lands on the end", () => {
    // The guard is half an interval, not a fixed second: at a 1s spacing a
    // fixed second would swallow the closing frame of almost every clip.
    expect(wantsEndFrame(10.2, planStills(10.2))).toBe(false);
  });

  it("wants nothing when the duration is unknown", () => {
    expect(wantsEndFrame(0, 1)).toBe(false);
    expect(wantsEndFrame(NaN, 1)).toBe(false);
  });
});

describe("stillTimestamp", () => {
  const ticksOnly = { count: 4, intervalSec: 1, durationSec: 20, endFrame: false };
  const withEnd = { count: 11, intervalSec: 1, durationSec: 10, endFrame: true };

  it("maps a tick index to its position in the clip", () => {
    expect(stillTimestamp(0, ticksOnly)).toBe(0);
    expect(stillTimestamp(3, ticksOnly)).toBe(3);
  });

  it("reads a stretched interval off the manifest, not off the target", () => {
    const stretched = { count: 46, intervalSec: 2, durationSec: 90, endFrame: true };
    expect(stillTimestamp(10, stretched)).toBe(20);
  });

  it("reads the closing still as the end of the clip, not as a tick", () => {
    expect(stillTimestamp(10, withEnd)).toBe(10);
    expect(stillTimestamp(10, { ...withEnd, durationSec: 12 })).toBe(12);
    // The ticks before it are unaffected.
    expect(stillTimestamp(9, withEnd)).toBe(9);
  });
});
