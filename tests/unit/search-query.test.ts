import { describe, it, expect } from "vitest";
import {
  parseSearchQuery,
  hasNarrowingPrefix,
  narrowingAxes,
  type SearchFields,
} from "@/lib/search-query";

function fields(p: Partial<SearchFields>): SearchFields {
  return {
    audience: p.audience ?? "",
    topic: p.topic ?? "",
    strategy: p.strategy ?? "",
    platform: p.platform ?? "",
    mc: p.mc ?? "",
    free: p.free ?? "",
  };
}

describe("parseSearchQuery", () => {
  it("empty query matches everything", () => {
    const m = parseSearchQuery("");
    expect(m(fields({}))).toBe(true);
    expect(m(fields({ free: "anything" }))).toBe(true);
  });

  it("free term searches across all fields", () => {
    const m = parseSearchQuery("retail");
    expect(m(fields({ free: "the retail thing" }))).toBe(true);
    expect(m(fields({ audience: "retail-eu" }))).toBe(true);
    expect(m(fields({ topic: "retail" }))).toBe(true);
    expect(m(fields({ free: "wholesale" }))).toBe(false);
  });

  it("a: prefix only matches audience field", () => {
    const m = parseSearchQuery("a:retail");
    expect(m(fields({ audience: "retail-eu" }))).toBe(true);
    expect(m(fields({ topic: "retail" }))).toBe(false);
    expect(m(fields({ free: "retail" }))).toBe(false);
  });

  it("t: prefix only matches topic field", () => {
    const m = parseSearchQuery("t:cf");
    expect(m(fields({ topic: "cf-launch" }))).toBe(true);
    expect(m(fields({ audience: "cf" }))).toBe(false);
  });

  it("s: prefix only matches strategy field", () => {
    const m = parseSearchQuery("s:performance");
    expect(m(fields({ strategy: "performance" }))).toBe(true);
    expect(m(fields({ free: "performance" }))).toBe(false);
  });

  it("mc: prefix only matches mc field", () => {
    const m = parseSearchQuery("mc:174");
    expect(m(fields({ mc: "mc174a" }))).toBe(true);
    expect(m(fields({ free: "174" }))).toBe(false);
  });

  it("mc: anchors on the whole number — mc:21 is not MC321 or MC210", () => {
    const m = parseSearchQuery("mc:21");
    expect(m(fields({ mc: "mc21a" }))).toBe(true);
    expect(m(fields({ mc: "mc21c" }))).toBe(true);
    // The prod bug (2026-09-04): mc:21 filled the grid with MC321's cells.
    expect(m(fields({ mc: "mc321a" }))).toBe(false);
    expect(m(fields({ mc: "mc210a" }))).toBe(false);
    expect(m(fields({ mc: "mc121b" }))).toBe(false);
  });

  it("mc: with a variant matches only that variant", () => {
    const m = parseSearchQuery("mc:21a");
    expect(m(fields({ mc: "mc21a" }))).toBe(true);
    expect(m(fields({ mc: "mc21b" }))).toBe(false);
    expect(m(fields({ mc: "mc321a" }))).toBe(false);
  });

  it("mc: accepts the label spelling too", () => {
    const m = parseSearchQuery("mc:mc21a");
    expect(m(fields({ mc: "mc21a" }))).toBe(true);
    expect(m(fields({ mc: "mc21b" }))).toBe(false);
  });

  it("mc: still substring-matches a non-label value (the matrix packs the pmmid in)", () => {
    const m = parseSearchQuery("mc:m_315-v_c");
    expect(m(fields({ mc: "mc315c a_sza-t_app-m_315-v_c-n_1" }))).toBe(true);
    expect(m(fields({ mc: "mc315a a_sza-t_app-m_315-v_a-n_1" }))).toBe(false);
  });

  it("multiple terms are AND-ed", () => {
    const m = parseSearchQuery("a:retail s:perf");
    expect(m(fields({ audience: "retail-eu", strategy: "performance" }))).toBe(true);
    expect(m(fields({ audience: "retail-eu", strategy: "awareness" }))).toBe(false);
    expect(m(fields({ audience: "smb", strategy: "performance" }))).toBe(false);
  });

  it("OR splits into alternatives", () => {
    const m = parseSearchQuery("a:retail OR mc:42");
    expect(m(fields({ audience: "retail-eu" }))).toBe(true);
    expect(m(fields({ mc: "mc42" }))).toBe(true);
    expect(m(fields({ audience: "smb", mc: "mc1" }))).toBe(false);
  });

  it("AND binds tighter than OR (no parens)", () => {
    const m = parseSearchQuery("a:retail s:perf OR mc:42");
    expect(m(fields({ audience: "retail-eu", strategy: "performance" }))).toBe(true);
    expect(m(fields({ mc: "mc42" }))).toBe(true);
    expect(m(fields({ audience: "retail-eu" }))).toBe(false);
    expect(m(fields({ audience: "retail-eu", strategy: "awareness" }))).toBe(false);
  });

  it("OR is case-insensitive", () => {
    const m1 = parseSearchQuery("a:retail or mc:1");
    const m2 = parseSearchQuery("a:retail Or mc:1");
    expect(m1(fields({ mc: "mc1" }))).toBe(true);
    expect(m2(fields({ mc: "mc1" }))).toBe(true);
  });

  it("quoted phrase is matched as a single substring", () => {
    const m = parseSearchQuery('"happy moments"');
    expect(m(fields({ free: "have some happy moments today" }))).toBe(true);
    expect(m(fields({ free: "happy and moments separately" }))).toBe(false);
  });

  it("quoted phrase after prefix", () => {
    const m = parseSearchQuery('a:"new client"');
    expect(m(fields({ audience: "the new client segment" }))).toBe(true);
    expect(m(fields({ audience: "new" }))).toBe(false);
  });

  it("matching is case-insensitive (input lowercased)", () => {
    const m = parseSearchQuery("RETAIL");
    expect(m(fields({ free: "RETAIL eu" }))).toBe(false);
    const m2 = parseSearchQuery("retail");
    expect(m2(fields({ free: "the RETAIL eu".toLowerCase() }))).toBe(true);
  });

  it("unknown prefix is treated as a free term", () => {
    const m = parseSearchQuery("brand:erste");
    expect(m(fields({ free: "brand:erste tagline" }))).toBe(true);
  });

  it("empty value after prefix is ignored", () => {
    const m = parseSearchQuery("a: mc:42");
    expect(m(fields({ mc: "mc42" }))).toBe(true);
    expect(m(fields({ mc: "mc1" }))).toBe(false);
  });

  it("only-whitespace query matches everything", () => {
    const m = parseSearchQuery("   \t  ");
    expect(m(fields({}))).toBe(true);
  });

  it("trailing OR with no rhs is dropped", () => {
    const m = parseSearchQuery("a:retail OR");
    expect(m(fields({ audience: "retail" }))).toBe(true);
    expect(m(fields({ audience: "smb" }))).toBe(false);
  });

  it("p: prefix matches platform field", () => {
    const m = parseSearchQuery("p:dv360");
    expect(m(fields({ platform: "dv360" }))).toBe(true);
    expect(m(fields({ platform: "facebook" }))).toBe(false);
    expect(m(fields({ free: "dv360" }))).toBe(false);
  });

  it("free term also searches platform field", () => {
    const m = parseSearchQuery("dv360");
    expect(m(fields({ platform: "dv360 ads" }))).toBe(true);
  });
});

describe("hasNarrowingPrefix", () => {
  it("returns false for empty / free-text-only queries", () => {
    expect(hasNarrowingPrefix("")).toBe(false);
    expect(hasNarrowingPrefix("retail eu")).toBe(false);
    expect(hasNarrowingPrefix('"happy moments"')).toBe(false);
  });

  it("returns true for a:/t:/s:/p:/mc: prefixes", () => {
    expect(hasNarrowingPrefix("a:retail")).toBe(true);
    expect(hasNarrowingPrefix("t:cf")).toBe(true);
    expect(hasNarrowingPrefix("s:performance")).toBe(true);
    expect(hasNarrowingPrefix("p:dv360")).toBe(true);
    expect(hasNarrowingPrefix("mc:174")).toBe(true);
  });

  it("returns true if any token in a multi-term query is narrowing", () => {
    expect(hasNarrowingPrefix("free a:retail mc:42")).toBe(true);
    expect(hasNarrowingPrefix("free mc:42")).toBe(true);
  });

  it("ignores empty prefix values", () => {
    expect(hasNarrowingPrefix("a:")).toBe(false);
  });

  it("unknown prefix is not narrowing", () => {
    expect(hasNarrowingPrefix("brand:erste")).toBe(false);
  });
});

describe("narrowingAxes", () => {
  it("free text / empty narrows neither axis", () => {
    expect(narrowingAxes("")).toEqual({ audience: false, topic: false });
    expect(narrowingAxes("retail eu")).toEqual({ audience: false, topic: false });
  });

  it("a:/p:/s: narrow only the audience (column) axis", () => {
    expect(narrowingAxes("a:retail")).toEqual({ audience: true, topic: false });
    expect(narrowingAxes("p:dv360")).toEqual({ audience: true, topic: false });
    expect(narrowingAxes("s:performance")).toEqual({ audience: true, topic: false });
  });

  it("t: narrows only the topic (row) axis", () => {
    expect(narrowingAxes("t:cf")).toEqual({ audience: false, topic: true });
  });

  it("mc: narrows both axes", () => {
    expect(narrowingAxes("mc:314a")).toEqual({ audience: true, topic: true });
  });

  it("combines axes across multiple terms", () => {
    expect(narrowingAxes("p:adform t:nemaradj")).toEqual({
      audience: true,
      topic: true,
    });
  });

  it("ignores empty prefix values and unknown prefixes", () => {
    expect(narrowingAxes("a:")).toEqual({ audience: false, topic: false });
    expect(narrowingAxes("brand:erste")).toEqual({ audience: false, topic: false });
  });
});
