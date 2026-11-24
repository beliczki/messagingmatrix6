import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@/lib/search-query";
import {
  pickPreviewSize,
  sharePreviewGroups,
  shareRowMatches,
  shareSearchFields,
  shareSearchText,
  type SnapshotLike,
} from "@/lib/share-list";

// Robi's rule for which picture stands for an MC on the Shares list
// (2026-11-24): "1080x1080 vagy 300x250 vagy ha az sincs négyzetes szerű
// méretekből". The expected indices below are read off that sentence.
describe("pickPreviewSize", () => {
  it("takes 1080x1080 over everything else", () => {
    expect(pickPreviewSize(["300x600", "300x250", "1080x1080", "1200x1200"])).toBe(2);
  });

  it("takes 300x250 when there is no 1080x1080", () => {
    expect(pickPreviewSize(["300x600", "970x250", "300x250", "1200x1200"])).toBe(2);
  });

  it("takes the most square size when neither is there", () => {
    // 640x600 is 1.07:1; 300x600 is 1:2, 1200x628 is 1.9:1, 970x250 is 3.9:1.
    expect(pickPreviewSize(["300x600", "970x250", "640x600", "1200x628"])).toBe(2);
  });

  it("breaks a tie in squareness by the larger picture", () => {
    expect(pickPreviewSize(["480x480", "1200x1200"])).toBe(1);
  });

  it("falls back to the first item when no size can be read", () => {
    expect(pickPreviewSize([null, "bogus"])).toBe(0);
    expect(pickPreviewSize(["bogus", "300x600"])).toBe(1);
  });
});

const snapshot: SnapshotLike = {
  messages: [
    // MC400a twice: the same card copied into a second audience.
    { id: 1, number: 400, variant: "a", headline: "Hitel most", copy1: "THM 9,9%", copy2: null, disclaimer: null, cta: "Részletek" },
    { id: 2, number: 400, variant: "a", headline: "Hitel most", copy1: "THM 9,9%", copy2: null, disclaimer: null, cta: "Részletek" },
    { id: 3, number: 400, variant: "b", headline: "Lakáshitel", copy1: null, copy2: null, disclaimer: "Részletek a bankban", cta: null },
  ],
  matrixItems: [
    { messageId: 1, size: "300x600" },
    { messageId: 1, size: "1080x1080" },
    { messageId: 2, size: "300x250" },
    { messageId: 3, size: "970x250" },
  ],
  creatives: [
    { id: 10, mcNumber: 12, mcVariant: "a", fileId: "f1", fileDimensions: "300x250", imageText: null },
    { id: 11, mcNumber: 12, mcVariant: "a", fileId: "f2", fileDimensions: "1080x1080", imageText: "Régi szöveg" },
    { id: 12, mcNumber: 13, mcVariant: null, fileId: "f3", fileDimensions: "1200x628", imageText: null },
    { id: 13, mcNumber: 14, mcVariant: "c", fileId: "gone", fileDimensions: "300x250", imageText: null },
  ],
  assets: [{ id: 20, fileId: "f4", fileDimensions: "200x200" }],
  files: [
    { id: "f1", mimeType: "image/png" },
    { id: "f2", mimeType: "image/jpeg" },
    { id: "f3", mimeType: "video/mp4" },
    { id: "f4", mimeType: "image/png" },
  ],
};

describe("sharePreviewGroups", () => {
  it("gives one picture per MC and variant, in viewer order, at the preferred size", () => {
    expect(sharePreviewGroups(snapshot)).toEqual([
      { label: "MC400a", size: "1080x1080", ref: { kind: "matrix", messageId: 1, size: "1080x1080" } },
      { label: "MC400b", size: "970x250", ref: { kind: "matrix", messageId: 3, size: "970x250" } },
      { label: "MC12a", size: "1080x1080", ref: { kind: "file", fileId: "f2", mimeType: "image/jpeg" } },
      { label: "MC13", size: "1200x628", ref: { kind: "file", fileId: "f3", mimeType: "video/mp4" } },
      // Its file is not in the snapshot's file list: nothing to show, but the
      // MC is still in the share and still steps.
      { label: "MC14c", size: "300x250", ref: { kind: "none" } },
      // An asset has no MC; it is its own entry.
      { label: null, size: "200x200", ref: { kind: "file", fileId: "f4", mimeType: "image/png" } },
    ]);
  });

  it("reads an empty or old snapshot as no pictures", () => {
    expect(sharePreviewGroups({})).toEqual([]);
  });
});

describe("shareSearchText", () => {
  it("collects the text on the creatives once each, current text first, the snapshot's where the row is gone", () => {
    const current = new Map<number, string | null>([
      [10, "Erste Diákszámla"],
      [12, "Erste Diákszámla"],
      [13, null],
    ]);
    // 11 is not in the current table (deleted), so its snapshot text stands.
    expect(shareSearchText(snapshot, current).split("\n")).toEqual([
      "Hitel most",
      "THM 9,9%",
      "Részletek",
      "Lakáshitel",
      "Részletek a bankban",
      "Erste Diákszámla",
      "Régi szöveg",
    ]);
  });
});

describe("shareRowMatches", () => {
  const row = {
    title: "SZA Online Számlaválasztó 2026 Q4",
    previews: [{ label: "MC12a" }, { label: "MC13" }, { label: null }],
    searchText: "Erste Diákszámla\nTHM 9,9%",
    products: ["SZA", "HK"],
  };
  const match = (q: string, products: string[] = []) =>
    shareRowMatches(row, parseSearchQuery(q), new Set(products), "(none)");

  it("finds a share by its name", () => {
    expect(match("számlaválasztó")).toBe(true);
    expect(match("bird")).toBe(false);
  });

  it("finds a share by an MC in it", () => {
    expect(match("mc:12a")).toBe(true);
    expect(match("mc:13")).toBe(true);
    expect(match("mc:15")).toBe(false);
  });

  it("finds a share by the text on its creatives", () => {
    expect(match("diákszámla")).toBe(true);
    expect(match('"thm 9,9%"')).toBe(true);
  });

  it("keeps a share when any of its products is picked", () => {
    expect(match("", ["HK"])).toBe(true);
    expect(match("", ["BIRD"])).toBe(false);
    expect(match("mc:12a", ["BIRD"])).toBe(false);
  });

  it("files a share with no product under the empty option", () => {
    const bare = { ...row, products: [] };
    expect(shareRowMatches(bare, parseSearchQuery(""), new Set(["(none)"]), "(none)")).toBe(true);
    expect(shareRowMatches(bare, parseSearchQuery(""), new Set(["SZA"]), "(none)")).toBe(false);
  });
});

describe("shareSearchFields", () => {
  it("puts the MC labels in the mc field and everything in the free field, lower-cased", () => {
    const f = shareSearchFields({
      title: "Bird",
      previews: [{ label: "MC12a" }, { label: null }],
      searchText: "THM",
    });
    expect(f.mc).toBe("mc12a");
    expect(f.free).toContain("bird");
    expect(f.free).toContain("mc12a");
    expect(f.free).toContain("thm");
  });
});
