import { describe, it, expect } from "vitest";
import {
  EMPTY_OPTION,
  describeSelection,
  optionValue,
  withEmptyOption,
} from "@/app/(app)/_components/MultiPill";

// The closed filter pill: one or two picks name themselves, three or more fall
// back to the count. The boundary is the whole point of the helper, so it is
// exercised from both sides.

describe("describeSelection", () => {
  const products = ["HK", "SZK", "LAK", "BIZT"];

  it("returns null when nothing is selected", () => {
    expect(describeSelection(new Set(), products)).toBeNull();
  });

  it("names a single selected value", () => {
    expect(describeSelection(new Set(["SZK"]), products)).toEqual({
      kind: "values",
      text: "SZK",
      full: "SZK",
    });
  });

  it("names two selected values in option order, not click order", () => {
    // Set insertion order is SZK-then-HK; the pill must still read "HK, SZK".
    expect(describeSelection(new Set(["SZK", "HK"]), products)).toEqual({
      kind: "values",
      text: "HK, SZK",
      full: "HK, SZK",
    });
  });

  it("switches to the count at three, keeping the values for the tooltip", () => {
    expect(describeSelection(new Set(["HK", "SZK", "LAK"]), products)).toEqual({
      kind: "count",
      text: "3",
      full: "HK, SZK, LAK",
    });
  });

  it("counts a selected value the options no longer carry", () => {
    // A persisted filter outliving its data still hides rows, so it still
    // counts — and lands after the known ones.
    expect(describeSelection(new Set(["SZK", "GONE"]), products)).toEqual({
      kind: "values",
      text: "SZK, GONE",
      full: "SZK, GONE",
    });
  });

  it("orders several orphans deterministically", () => {
    const label = describeSelection(new Set(["ZZZ", "HK", "AAA"]), products);
    expect(label).toEqual({ kind: "count", text: "3", full: "HK, AAA, ZZZ" });
  });
});

describe("empty option", () => {
  it("lets every row satisfy 'select all' — an empty field filters under (none)", () => {
    const rows = [{ product: "SZK" }, { product: null }, { product: "" }];
    const options = withEmptyOption(["SZK"], rows.some((r) => !r.product));
    expect(options).toEqual(["SZK", EMPTY_OPTION]);
    const all = new Set(options);
    expect(rows.filter((r) => all.has(optionValue(r.product)))).toHaveLength(3);
    // Only the untagged ones when (none) alone is picked.
    const none = new Set([EMPTY_OPTION]);
    expect(rows.filter((r) => none.has(optionValue(r.product)))).toHaveLength(2);
  });

  it("adds no (none) option when every row has a value", () => {
    expect(withEmptyOption(["HK", "SZK"], false)).toEqual(["HK", "SZK"]);
  });
});
