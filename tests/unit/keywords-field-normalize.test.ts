import { describe, it, expect } from "vitest";
import { normalizeXlsxFieldName } from "@/lib/import-xlsx";

describe("normalizeXlsxFieldName (keywords sheet XLSX header → v6 camelCase)", () => {
  it("lowercases the first letter for single-word headers", () => {
    expect(normalizeXlsxFieldName("Product")).toBe("product");
    expect(normalizeXlsxFieldName("Status")).toBe("status");
    expect(normalizeXlsxFieldName("Device")).toBe("device");
    expect(normalizeXlsxFieldName("Strategy")).toBe("strategy");
  });

  it("converts snake_case → camelCase", () => {
    expect(normalizeXlsxFieldName("Buying_platform")).toBe("buyingPlatform");
    expect(normalizeXlsxFieldName("Data_source")).toBe("dataSource");
    expect(normalizeXlsxFieldName("Targeting_type")).toBe("targetingType");
  });

  it("preserves digit-suffixed fields", () => {
    expect(normalizeXlsxFieldName("Tag1")).toBe("tag1");
    expect(normalizeXlsxFieldName("Tag2")).toBe("tag2");
    expect(normalizeXlsxFieldName("Tag3")).toBe("tag3");
    expect(normalizeXlsxFieldName("Tag4")).toBe("tag4");
  });

  it("handles empty / whitespace input", () => {
    expect(normalizeXlsxFieldName("")).toBe("");
    expect(normalizeXlsxFieldName("   ")).toBe("");
  });

  it("idempotent on already-camelCase input", () => {
    expect(normalizeXlsxFieldName("buyingPlatform")).toBe("buyingPlatform");
    expect(normalizeXlsxFieldName("status")).toBe("status");
  });
});
