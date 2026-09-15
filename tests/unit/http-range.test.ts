import { describe, expect, it } from "vitest";
import { parseRangeHeader } from "@/lib/http-range";

describe("parseRangeHeader", () => {
  const total = 1000;

  it("treats a missing or unparseable header as no range", () => {
    expect(parseRangeHeader(null, total)).toEqual({ kind: "none" });
    expect(parseRangeHeader("", total)).toEqual({ kind: "none" });
    expect(parseRangeHeader("items=0-10", total)).toEqual({ kind: "none" });
    // Multi-range: answering with the whole body is always valid.
    expect(parseRangeHeader("bytes=0-10,20-30", total)).toEqual({ kind: "none" });
    expect(parseRangeHeader("bytes=-", total)).toEqual({ kind: "none" });
  });

  it("parses a closed range", () => {
    expect(parseRangeHeader("bytes=0-99", total)).toEqual({
      kind: "range",
      start: 0,
      end: 99,
    });
  });

  it("parses an open-ended range to the last byte", () => {
    // What Chrome sends first for a <video>.
    expect(parseRangeHeader("bytes=0-", total)).toEqual({
      kind: "range",
      start: 0,
      end: 999,
    });
  });

  it("parses a suffix range — the moov-atom probe of a non-faststart MP4", () => {
    expect(parseRangeHeader("bytes=-500", total)).toEqual({
      kind: "range",
      start: 500,
      end: 999,
    });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(parseRangeHeader("bytes=-5000", total)).toEqual({
      kind: "range",
      start: 0,
      end: 999,
    });
  });

  it("clamps an end past the last byte", () => {
    expect(parseRangeHeader("bytes=900-5000", total)).toEqual({
      kind: "range",
      start: 900,
      end: 999,
    });
  });

  it("rejects a start past the end of the file", () => {
    expect(parseRangeHeader("bytes=1000-1099", total)).toEqual({
      kind: "unsatisfiable",
    });
  });

  it("rejects an inverted range and a zero-length suffix", () => {
    expect(parseRangeHeader("bytes=500-400", total)).toEqual({
      kind: "unsatisfiable",
    });
    expect(parseRangeHeader("bytes=-0", total)).toEqual({ kind: "unsatisfiable" });
  });

  it("can satisfy no range at all on an empty object", () => {
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
