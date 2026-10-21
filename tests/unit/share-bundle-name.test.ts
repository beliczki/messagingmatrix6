import { describe, it, expect } from "vitest";
import { shareBundleName } from "@/lib/share-bundle-name";

describe("shareBundleName", () => {
  it("folds accents, turns spaces into underscores and counts the files", () => {
    expect(shareBundleName("Bird VALL és MASS remarketing v2", 2)).toBe(
      "Bird_VALL_es_MASS_remarketing_v2-bundleOf2.zip",
    );
    expect(shareBundleName("Őszi  hűség: árvíztűrő / tükörfúrógép", 44)).toBe(
      "Oszi_huseg_arvizturo_tukorfurogep-bundleOf44.zip",
    );
  });

  it("falls back to 'share' for an untitled share", () => {
    expect(shareBundleName(null, 3)).toBe("share-bundleOf3.zip");
    expect(shareBundleName("  ", 1)).toBe("share-bundleOf1.zip");
  });
});
