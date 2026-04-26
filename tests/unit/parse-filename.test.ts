import { describe, it, expect } from "vitest";
import { parseFilename, type ParseRules } from "@/lib/parse-filename";

const ERSTE_RULES: ParseRules = {
  brand: { type: "segment", index: 0, separator: "_" },
  product: { type: "segment", index: 1, separator: "_" },
  type: { type: "extension_type" },
  mcNumber: { type: "pattern", pattern: "MC(\\d+)", group: 1 },
  mcVariant: { type: "segment", index: 3, separator: "_" },
  size: { type: "pattern", pattern: "(\\d+x\\d+)", group: 1 },
};

describe("parseFilename — Erste filename convention", () => {
  it("parses ERSTE_SZK_MC174_e_calculator_mockup_szabad_n1_300x600.png", () => {
    const { fields, warnings } = parseFilename(
      "ERSTE_SZK_MC174_e_calculator_mockup_szabad_n1_300x600.png",
      ERSTE_RULES,
    );
    expect(fields).toMatchObject({
      brand: "ERSTE",
      product: "SZK",
      type: "image",
      mcNumber: "174",
      mcVariant: "e",
      size: "300x600",
    });
    expect(warnings).toHaveLength(0);
  });

  it("parses a path-prefixed filename (drops directory parts)", () => {
    const { fields } = parseFilename(
      "/some/local/path/ERSTE_VAL_MC1a_300x250.jpg",
      ERSTE_RULES,
    );
    expect(fields.brand).toBe("ERSTE");
    expect(fields.product).toBe("VAL");
  });

  it("video mime-type maps to type=video", () => {
    const { fields } = parseFilename("ERSTE_SZK_loop.mp4", ERSTE_RULES);
    expect(fields.type).toBe("video");
  });

  it("missing optional segments are flagged as warnings, not errors", () => {
    const { fields, warnings } = parseFilename("ERSTE_SZK.png", ERSTE_RULES);
    expect(fields.brand).toBe("ERSTE");
    expect(fields.product).toBe("SZK");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.startsWith("mcNumber"))).toBe(true);
  });
});

describe("parseFilename — rule types", () => {
  it("fixed", () => {
    const { fields } = parseFilename("anything.png", {
      x: { type: "fixed", value: "constant" },
    });
    expect(fields.x).toBe("constant");
  });

  it("after_segment joins remainder", () => {
    const { fields } = parseFilename(
      "BRAND_PROD_keyword_with_underscores.png",
      {
        keyword: { type: "after_segment", index: 2, separator: "_" },
      },
    );
    expect(fields.keyword).toBe("keyword_with_underscores");
  });

  it("last_segment picks the final component", () => {
    const { fields } = parseFilename("a_b_c_d.png", {
      tail: { type: "last_segment", separator: "_" },
    });
    expect(fields.tail).toBe("d");
  });

  it("extension returns just the ext without dot, lowercased", () => {
    const { fields } = parseFilename("X.JPEG", {
      ext: { type: "extension" },
    });
    expect(fields.ext).toBe("jpeg");
  });

  it("pattern with explicit group", () => {
    const { fields } = parseFilename("foo_v3_bar.png", {
      version: { type: "pattern", pattern: "v(\\d+)", group: 1 },
    });
    expect(fields.version).toBe("3");
  });

  it("rule that doesn't match → field absent + warning", () => {
    const { fields, warnings } = parseFilename("plain.png", {
      mc: { type: "pattern", pattern: "MC(\\d+)", group: 1 },
    });
    expect(fields.mc).toBeUndefined();
    expect(warnings).toEqual(["mc: rule did not match"]);
  });
});
