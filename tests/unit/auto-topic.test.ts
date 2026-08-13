import { describe, it, expect } from "vitest";
import { autoTopicFromFilename } from "@/lib/entities/promote";

describe("autoTopicFromFilename", () => {
  it("strips quarter, render-hint and size; keeps the theme token", () => {
    const t = autoTopicFromFilename(
      "ERSTE_SZA_MC289_a_diakszamla_2026Q1_fullImage_640x360.jpg",
    );
    expect(t.key).toBe("diakszamla");
    expect(t.name).toBe("Diakszamla");
  });

  it("strips version token _nN_ (via the parser) and keeps multi-word themes", () => {
    const t = autoTopicFromFilename("ERSTE_SZA_MC_a_baba_szamla_n3_300x250.png");
    expect(t.key).toBe("baba-szamla");
    expect(t.name).toBe("Baba Szamla");
  });

  it("is deterministic across sizes/versions of the same family (freeze-safe)", () => {
    const a = autoTopicFromFilename(
      "ERSTE_SZA_MC289_a_diakszamla_2026Q1_fullImage_640x360.jpg",
    );
    const b = autoTopicFromFilename(
      "ERSTE_SZA_MC289_a_diakszamla_2026Q1_n2_300x250.png",
    );
    expect(a.key).toBe(b.key);
  });

  it("falls back to product when there are no keyword tokens", () => {
    const t = autoTopicFromFilename("ERSTE_SZA_300x250.png");
    expect(t.key).toBe("sza");
    expect(t.name).toBe("Sza");
  });

  it("falls back to 'creative' when nothing usable remains", () => {
    const t = autoTopicFromFilename("2026Q1_970x250.png");
    expect(t.key).toBe("creative");
  });
});
