import { describe, expect, it } from "vitest";
import { creativeMediaKind } from "@/lib/creative-media-kind";

describe("creativeMediaKind", () => {
  it("reads the stored mime first", () => {
    expect(creativeMediaKind("application/zip", "x.png")).toBe("html5");
    expect(creativeMediaKind("image/svg+xml")).toBe("image");
    expect(creativeMediaKind("video/quicktime")).toBe("video");
    expect(creativeMediaKind("application/pdf")).toBe("other");
  });

  it("falls back to the name when no mime is known (a cell's image1)", () => {
    expect(creativeMediaKind(null, "ERSTE_SZA_MC411_b_x_html5_n1_300x250.zip")).toBe("html5");
    expect(creativeMediaKind(undefined, "a.JPG")).toBe("image");
    expect(creativeMediaKind(null, "a.mp4")).toBe("video");
    expect(creativeMediaKind(null, "a.html")).toBe("other");
    expect(creativeMediaKind(null, null)).toBe("other");
  });
});
