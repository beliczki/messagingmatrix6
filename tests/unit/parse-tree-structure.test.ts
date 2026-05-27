import { describe, it, expect } from "vitest";
import { parseTreeStructure } from "@/app/(app)/matrix/_tree/parseTreeStructure";

describe("parseTreeStructure", () => {
  it("parses the default 5-level tree", () => {
    const levels = parseTreeStructure(
      "Product → Strategy → Audience → Topic → Messages",
    );
    expect(levels).toEqual([
      { kind: "group", source: "audience", field: "product", label: "Product" },
      { kind: "group", source: "audience", field: "strategy", label: "Strategy" },
      { kind: "audience" },
      { kind: "topic" },
      { kind: "messages" },
    ]);
  });

  it("accepts Source.Field disambiguation", () => {
    const levels = parseTreeStructure("Topics.Tag1 → Audiences.Strategy → Messages");
    expect(levels).toEqual([
      { kind: "group", source: "topic", field: "tag1", label: "Tag1" },
      { kind: "group", source: "audience", field: "strategy", label: "Strategy" },
      { kind: "messages" },
    ]);
  });

  it("is whitespace-tolerant and case-insensitive", () => {
    const levels = parseTreeStructure("  product  →  STRATEGY → audience → topic → messages  ");
    expect(levels).toHaveLength(5);
    expect(levels[0]).toEqual({ kind: "group", source: "audience", field: "product", label: "Product" });
  });

  it("returns empty for empty input", () => {
    expect(parseTreeStructure("")).toEqual([]);
    expect(parseTreeStructure("   ")).toEqual([]);
  });

  it("throws on unknown field", () => {
    expect(() => parseTreeStructure("Product → Banana → Messages")).toThrow(
      /Unknown level "Banana"/,
    );
  });

  it("throws on unknown source in Source.Field form", () => {
    expect(() => parseTreeStructure("Foobar.Tag1 → Messages")).toThrow(
      /Unknown source/,
    );
  });

  it("rejects Messages.Field — Messages must be a leaf", () => {
    expect(() => parseTreeStructure("Messages.Headline")).toThrow(
      /Messages can only appear as a leaf level/,
    );
  });
});
