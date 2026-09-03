import { describe, it, expect } from "vitest";
import {
  mediaKindFromFilename,
  parseFilename,
  type ParseRules,
} from "@/lib/parse-filename";
import { DEFAULT_CREATIVE_PARSING_RULES } from "@/db/defaults";

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

describe("mediaKindFromFilename", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(mediaKindFromFilename("ERSTE_SZK_MC104_a_n1_480x480.mp4")).toBe("video");
    expect(mediaKindFromFilename("banner.PNG")).toBe("image");
    expect(mediaKindFromFilename("bundle.zip")).toBe("html");
  });

  it("reads the extension off the basename, not the path", () => {
    // A directory with a dot in it must not be mistaken for the extension.
    expect(mediaKindFromFilename("v1.2/spot.mp4")).toBe("video");
    expect(mediaKindFromFilename("v1.2/README")).toBeNull();
  });

  it("returns null for an extension the importer does not know", () => {
    expect(mediaKindFromFilename("notes.txt")).toBeNull();
    expect(mediaKindFromFilename("noextension")).toBeNull();
  });
});

describe("MC number + variant rules (DEFAULT_CREATIVE_PARSING_RULES)", () => {
  it("reads both out of the delivery naming convention", () => {
    const { fields } = parseFilename(
      "ERSTE_SZA_MC324_b_DiakszamlaQ3_n2_1080x1080.jpg",
      DEFAULT_CREATIVE_PARSING_RULES as ParseRules,
    );
    expect(fields.brand).toBe("ERSTE");
    expect(fields.product).toBe("SZA");
    expect(fields.type).toBe("image");
    expect(fields.mcNumber).toBe("324");
    expect(fields.mcVariant).toBe("b");
  });

  it("leaves the variant blank where the token is not one — never guesses", () => {
    // 48 of the 3145 live creatives carry va / vc / px / bg / c1 here, and the
    // library files them all under variant "a". A wrong prefill is worse than
    // an empty field the uploader fills in.
    for (const name of [
      "ERSTE_HITEL_MC3_va_68b555b_babavaro_n1_1080x1080.mp4",
      "ERSTE_HITEL_MC24_px_Munkashitel_prospecting_1_n1_1080x1080.jpg",
      "ERSTE_SZA_MC343_bg_Teads_Cseperedo_n1_960x540.png",
      "ERSTE_SZA_MC347_c1_Cseperedo_prospecting_n1_1080x1080.png",
    ]) {
      const { fields } = parseFilename(name, DEFAULT_CREATIVE_PARSING_RULES as ParseRules);
      expect(fields.mcNumber).toBe(name.match(/MC(\d+)/)![1]);
      expect(fields.mcVariant).toBeUndefined();
    }
  });

  it("still parses an MCx (no number) name without inventing a number", () => {
    const { fields } = parseFilename(
      "ERSTE_MARKET_MCx_e_genZbefektetes_2026Q1_n1_300x250.jpg",
      DEFAULT_CREATIVE_PARSING_RULES as ParseRules,
    );
    expect(fields.mcNumber).toBeUndefined();
    expect(fields.mcVariant).toBeUndefined();
  });
});
