import { describe, expect, it } from "vitest";
import {
  MAX_STILLS,
  STILL_INTERVAL_SEC,
  planStills,
  stillTimestamp,
} from "@/lib/video-stills";

describe("planStills", () => {
  it("gives a clip one still per 5 seconds, tail included", () => {
    // 17s covers 0.1 / 5.1 / 10.1 / 15.1 — the partial last interval still
    // earns a frame, which is why the extraction uses `select` and not `fps`.
    expect(planStills(17)).toBe(4);
    expect(planStills(15)).toBe(3);
    expect(planStills(30)).toBe(6);
  });

  it("gives a clip shorter than one interval a single still", () => {
    expect(planStills(0.5)).toBe(1);
    expect(planStills(5)).toBe(1);
  });

  it("caps a long clip instead of writing thousands of JPEGs", () => {
    expect(planStills(MAX_STILLS * STILL_INTERVAL_SEC)).toBe(MAX_STILLS);
    expect(planStills(10 * 60 * 60)).toBe(MAX_STILLS);
  });

  it("falls back to one still when the duration is unknown", () => {
    expect(planStills(0)).toBe(1);
    expect(planStills(NaN)).toBe(1);
    expect(planStills(-3)).toBe(1);
  });
});

describe("stillTimestamp", () => {
  it("maps a still index back to its position in the clip", () => {
    expect(stillTimestamp(0)).toBe(0);
    expect(stillTimestamp(3)).toBe(15);
  });
});
