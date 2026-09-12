import { describe, it, expect } from "vitest";
import { imageSlots, resolveImageSlots } from "@/lib/entities/drafts";

// The slots are roles the TEMPLATE names, so the mapping to the image1..6
// columns is read off the manifest bindings rather than assumed positionally.
const template = {
  name: "demo",
  placeholders: [
    { name: "headline_text_1", type: "text" },
    { name: "background_image_1", type: "image", binding: "Image1" },
    { name: "background_image_2", type: "image", binding: "Image2" },
    { name: "brand_image_1", type: "image", binding: "Image5" },
    { name: "background_video_1", type: "video", binding: "Video1" },
    { name: "loose_image", type: "image" },
  ],
};

describe("imageSlots", () => {
  it("maps a template's image slots to the columns their bindings name", () => {
    expect([...imageSlots(template).entries()]).toEqual([
      ["background_image_1", "image1"],
      ["background_image_2", "image2"],
      ["brand_image_1", "image5"],
    ]);
  });

  it("skips a video slot and an image slot bound to nothing", () => {
    const names = [...imageSlots(template).keys()];
    expect(names).not.toContain("background_video_1");
    expect(names).not.toContain("loose_image");
  });
});

describe("resolveImageSlots", () => {
  it("writes each named slot to its own column and leaves the others alone", () => {
    const { fields, problems } = resolveImageSlots(template, {
      brand_image_1: "logo.svg",
    });
    expect(fields).toEqual({ image5: "logo.svg" });
    expect(problems).toEqual([]);
  });

  it("keeps an empty string — that is how a caller clears one slot", () => {
    const { fields } = resolveImageSlots(template, { background_image_2: "" });
    expect(fields).toEqual({ image2: "" });
  });

  it("reports a slot this template does not declare, naming the ones it has", () => {
    const { fields, problems } = resolveImageSlots(template, {
      sticker_image_1: "sticker.png",
    });
    expect(fields).toEqual({});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sticker_image_1");
    expect(problems[0]).toContain("background_image_1");
  });
});
