import { describe, it, expect } from "vitest";
import { trimEmptyCountSegments } from "@/lib/count-segments";

describe("trimEmptyCountSegments", () => {
  // Erste has no channel audiences, so the nonDCO column read 0 down the whole
  // menu — the user's first question about it was "what is that middle zero?".
  it("drops a segment that is zero for every option", () => {
    const r = trimEmptyCountSegments(
      { SZK: [1197, 0, 639], VAL: [245, 0, 273] },
      ["DCO", "nonDCO", "creatives"],
    );
    expect(r.labels).toEqual(["DCO", "creatives"]);
    expect(r.counts).toEqual({ SZK: [1197, 639], VAL: [245, 273] });
  });

  it("keeps a segment that is non-zero for even one option", () => {
    const r = trimEmptyCountSegments(
      { SZK: [1, 0, 0], VAL: [0, 3, 0] },
      ["a", "b", "c"],
    );
    expect(r.labels).toEqual(["a", "b"]);
    expect(r.counts).toEqual({ SZK: [1, 0], VAL: [0, 3] });
  });

  it("never trims down to nothing", () => {
    const r = trimEmptyCountSegments({ SZK: [0, 0] }, ["a", "b"]);
    expect(r.labels).toEqual(["a"]);
    expect(r.counts).toEqual({ SZK: [0] });
  });

  it("leaves a full set alone", () => {
    const counts = { SZK: [1, 2], VAL: [3, 4] };
    const r = trimEmptyCountSegments(counts, ["a", "b"]);
    expect(r.counts).toBe(counts);
    expect(r.labels).toEqual(["a", "b"]);
  });

  it("handles an empty menu", () => {
    expect(trimEmptyCountSegments({}, ["a"])).toEqual({ counts: {}, labels: ["a"] });
  });
});
