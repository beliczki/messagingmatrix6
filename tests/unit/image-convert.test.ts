import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertImage } from "@/lib/image-convert";
import {
  formatOfFilename,
  isConvertibleImage,
  parseImageFormat,
  parseJpgQuality,
  withImageFormat,
} from "@/lib/image-formats";

// A half-transparent noisy picture: noise so quality changes the byte count,
// alpha so the JPG background is observable.
async function source(): Promise<Buffer> {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    raw[i * 4] = (i * 37) % 256;
    raw[i * 4 + 1] = (i * 91) % 256;
    raw[i * 4 + 2] = (i * 13) % 256;
    raw[i * 4 + 3] = i < (w * h) / 2 ? 0 : 255;
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe("convertImage", () => {
  it("encodes each format with its content type", async () => {
    const src = await source();
    for (const [as, type, fmt] of [
      ["jpg", "image/jpeg", "jpeg"],
      ["png", "image/png", "png"],
      ["webp", "image/webp", "webp"],
      ["avif", "image/avif", "heif"],
    ] as const) {
      const out = await convertImage(src, as, 70);
      expect(out.contentType).toBe(type);
      expect((await sharp(out.bytes).metadata()).format).toBe(fmt);
    }
  });

  it("lays a transparent picture on white for JPG", async () => {
    const out = await convertImage(await source(), "jpg", 90);
    const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    // First pixel was fully transparent.
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(240);
    expect(data[2]).toBeGreaterThan(240);
  });

  it("takes the JPG quality", async () => {
    const src = await source();
    const low = await convertImage(src, "jpg", 10);
    const high = await convertImage(src, "jpg", 95);
    expect(low.bytes.length).toBeLessThan(high.bytes.length);
  });
});

describe("image format params", () => {
  it("parses only the four formats", () => {
    expect(parseImageFormat("avif")).toBe("avif");
    expect(parseImageFormat("gif")).toBeNull();
    expect(parseImageFormat(null)).toBeNull();
  });

  it("falls back to 70 for a missing or out-of-range quality", () => {
    expect(parseJpgQuality("85")).toBe(85);
    expect(parseJpgQuality(null)).toBe(70);
    expect(parseJpgQuality("0")).toBe(70);
    expect(parseJpgQuality("101")).toBe(70);
    expect(parseJpgQuality("7.5")).toBe(70);
  });

  it("knows what a file already is, and what can be converted", () => {
    expect(formatOfFilename("a_480x480.PNG")).toBe("png");
    expect(formatOfFilename("a.jpeg")).toBe("jpg");
    expect(formatOfFilename("a.mp4")).toBeNull();
    expect(isConvertibleImage("image/png")).toBe(true);
    expect(isConvertibleImage("image/svg+xml")).toBe(false);
    expect(isConvertibleImage("video/mp4")).toBe(false);
  });

  it("appends to an address that already has a query", () => {
    expect(withImageFormat("/p/x/300x250?v=1", "jpg", 70)).toBe("/p/x/300x250?v=1&as=jpg&q=70");
    expect(withImageFormat("/share/s/file/f", "webp", 70)).toBe("/share/s/file/f?as=webp");
  });
});
