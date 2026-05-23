import { describe, it, expect } from "vitest";
import { evaluatePattern } from "@/lib/patterns";

describe("evaluatePattern — join(...) top-level form", () => {
  it("joins three non-empty values with _", () => {
    expect(
      evaluatePattern("join({{a}}, {{b}}, {{c}})", { a: "x", b: "y", c: "z" }),
    ).toBe("x_y_z");
  });

  it("drops empty arguments", () => {
    expect(
      evaluatePattern("join({{a}}, {{b}}, {{c}})", { a: "x", b: "", c: "z" }),
    ).toBe("x_z");
  });

  it("drops 'NA' case-insensitively (incl. after |lower)", () => {
    expect(
      evaluatePattern("join({{a|lower}}, {{b|lower}}, {{c|lower}})", {
        a: "X",
        b: "NA",
        c: "Z",
      }),
    ).toBe("x_z");
    expect(
      evaluatePattern("join({{a}}, {{b}}, {{c}})", { a: "x", b: "na", c: "z" }),
    ).toBe("x_z");
  });

  it("drops literal 'NA' arguments", () => {
    expect(
      evaluatePattern("join({{a}}, {{b}}, {{c}})", {
        a: "x",
        b: "NA",
        c: "z",
      }),
    ).toBe("x_z");
  });

  it("drops both empty and 'NA' in the same call", () => {
    expect(
      evaluatePattern(
        "join({{product}}, {{tag1}}, {{tag2}}, {{tag3}}, {{tag4}})",
        {
          product: "SZA",
          tag1: "",
          tag2: "gyorsasag",
          tag3: "NA",
          tag4: "par-per",
        },
      ),
    ).toBe("SZA_gyorsasag_par-per");
  });

  it("returns empty string when all args are empty/NA", () => {
    expect(
      evaluatePattern("join({{a}}, {{b}}, {{c}})", {
        a: "",
        b: "NA",
        c: "",
      }),
    ).toBe("");
  });

  it("applies |lower modifier inside join arguments", () => {
    expect(
      evaluatePattern(
        "join({{product|lower}}, {{tag1|lower}}, {{tag2|lower}})",
        { product: "SZA", tag1: "GYORSASAG", tag2: "" },
      ),
    ).toBe("sza_gyorsasag");
  });

  it("supports plain text literals as arguments", () => {
    expect(
      evaluatePattern("join(prefix, {{x}}, suffix)", { x: "" }),
    ).toBe("prefix_suffix");
  });

  it("single argument is returned as-is", () => {
    expect(evaluatePattern("join({{a}})", { a: "hello" })).toBe("hello");
  });

  it("zero arguments → empty string", () => {
    expect(evaluatePattern("join()", {})).toBe("");
  });

  it("non-join pattern is unaffected (regression guard)", () => {
    expect(
      evaluatePattern("{{product|lower}}_{{tag1|lower}}", {
        product: "SZA",
        tag1: "GYORS",
      }),
    ).toBe("sza_gyors");
  });

  it("missing context keys treated as empty", () => {
    expect(
      evaluatePattern("join({{a}}, {{missing}}, {{b}})", { a: "x", b: "y" }),
    ).toBe("x_y");
  });
});
