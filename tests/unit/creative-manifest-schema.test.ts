import { describe, it, expect } from "vitest";
import { creativeManifestSchema } from "@/lib/creative-manifest";

// The manifest's form is the contract with the Codex delivery
// (src/lib/creative-manifest.md). Keywords, as Robi decided on 2026-11-23:
// 3–6 of them, lowercase, Hungarian, separated by commas.

function group(over: Record<string, unknown> = {}) {
  return {
    mc: 101,
    variant: "c",
    image_text: "ERSTE\nSzemélyi kölcsön",
    image_description: "Szemüveges férfi laptoppal.",
    copy_keyword: "személyi kölcsön, fix kamat, karrierváltás",
    visual_keyword: "férfi, kávézó, szemüveg, laptop",
    files: ["a_1080x1080.png"],
    ...over,
  };
}

function manifest(groups: unknown[], over: Record<string, unknown> = {}) {
  return { version: 1, client: "erste", source: "codex", groups, ...over };
}

const parse = (m: unknown) => creativeManifestSchema.safeParse(m);

describe("creativeManifestSchema", () => {
  it("accepts 3 and 6 keywords and writes them as `a, b, c`", () => {
    const r = parse(
      manifest([
        group({ copy_keyword: "személyi kölcsön,fix kamat ,  karrierváltás" }),
        group({ visual_keyword: "a, b, c, d, e, f", files: ["b_300x250.png"] }),
      ]),
    );
    expect(r.success).toBe(true);
    expect(r.data!.groups[0]!.copy_keyword).toBe("személyi kölcsön, fix kamat, karrierváltás");
    expect(r.data!.groups[1]!.visual_keyword).toBe("a, b, c, d, e, f");
  });

  it("rejects fewer than 3 or more than 6 keywords", () => {
    expect(parse(manifest([group({ copy_keyword: "egy, kettő" })])).success).toBe(false);
    expect(parse(manifest([group({ visual_keyword: "a, b, c, d, e, f, g" })])).success).toBe(false);
  });

  it("rejects a keyword with a capital letter", () => {
    expect(parse(manifest([group({ copy_keyword: "Személyi kölcsön, fix kamat, thm" })])).success).toBe(false);
    expect(parse(manifest([group({ visual_keyword: "férfi, KÁVÉZÓ, laptop" })])).success).toBe(false);
  });

  it("rejects an empty keyword between two commas", () => {
    expect(parse(manifest([group({ copy_keyword: "a, , b, c" })])).success).toBe(false);
  });

  it("rejects a file listed in two groups", () => {
    expect(parse(manifest([group(), group({ variant: "d" })])).success).toBe(false);
  });

  it("rejects an empty file list, a blank text, a wrong version or a misspelt key", () => {
    expect(parse(manifest([group({ files: [] })])).success).toBe(false);
    expect(parse(manifest([group({ image_text: "  " })])).success).toBe(false);
    expect(parse(manifest([group()], { version: 2 })).success).toBe(false);
    expect(parse(manifest([group({ visual_keywords: "a, b, c" })])).success).toBe(false);
  });

  it("rejects a variant that is not one lowercase letter", () => {
    expect(parse(manifest([group({ variant: "C" })])).success).toBe(false);
    expect(parse(manifest([group({ variant: "cd" })])).success).toBe(false);
  });
});
