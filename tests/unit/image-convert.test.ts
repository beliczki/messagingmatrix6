import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { convertImage } from "@/lib/image-convert";
import {
  formatOfFilename,
  isConvertibleImage,
  parseGifColors,
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

const enc = (jpgQuality: number, gifColors: number) => ({ jpgQuality, gifColors });

describe("convertImage", () => {
  it("encodes each format with its content type", async () => {
    const src = await source();
    for (const [as, type, fmt] of [
      ["jpg", "image/jpeg", "jpeg"],
      ["png", "image/png", "png"],
      ["webp", "image/webp", "webp"],
      ["avif", "image/avif", "heif"],
      ["gif", "image/gif", "gif"],
    ] as const) {
      const out = await convertImage(src, as, enc(70, 256));
      expect(out.contentType).toBe(type);
      expect((await sharp(out.bytes).metadata()).format).toBe(fmt);
    }
  });

  it("lays a transparent picture on white for JPG", async () => {
    const out = await convertImage(await source(), "jpg", enc(90, 256));
    const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    // First pixel was fully transparent.
    expect(data[0]).toBeGreaterThan(240);
    expect(data[1]).toBeGreaterThan(240);
    expect(data[2]).toBeGreaterThan(240);
  });

  it("takes the JPG quality", async () => {
    const src = await source();
    const low = await convertImage(src, "jpg", enc(10, 256));
    const high = await convertImage(src, "jpg", enc(95, 256));
    expect(low.bytes.length).toBeLessThan(high.bytes.length);
  });

  // Counted in the output, not inferred from the size: sharp on its own rounds
  // every one of these palettes up to 256 (see gifWithPalette).
  it("gives a GIF exactly the palette asked for", async () => {
    const w = 200;
    const h = 200;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        raw[i] = x;
        raw[i + 1] = y;
        raw[i + 2] = (x * 7 + y * 3) % 256;
      }
    }
    const src = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    for (const colours of [32, 64, 128]) {
      const out = await convertImage(src, "gif", enc(70, colours));
      const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += info.channels) seen.add(data.readUIntBE(i, 3));
      expect(seen.size).toBe(colours);
    }
  });
});

describe("image format params", () => {
  it("parses only the five formats", () => {
    expect(parseImageFormat("avif")).toBe("avif");
    expect(parseImageFormat("gif")).toBe("gif");
    expect(parseImageFormat("bmp")).toBeNull();
    expect(parseImageFormat(null)).toBeNull();
  });

  it("falls back to 70 for a missing or out-of-range quality", () => {
    expect(parseJpgQuality("85")).toBe(85);
    expect(parseJpgQuality(null)).toBe(70);
    expect(parseJpgQuality("0")).toBe(70);
    expect(parseJpgQuality("101")).toBe(70);
    expect(parseJpgQuality("7.5")).toBe(70);
    expect(parseGifColors("64")).toBe(64);
    expect(parseGifColors("100")).toBe(256);
    expect(parseGifColors(null)).toBe(256);
  });

  it("knows what a file already is, and what can be converted", () => {
    expect(formatOfFilename("a_480x480.PNG")).toBe("png");
    expect(formatOfFilename("a.jpeg")).toBe("jpg");
    expect(formatOfFilename("a.gif")).toBe("gif");
    expect(formatOfFilename("a.mp4")).toBeNull();
    expect(isConvertibleImage("image/png")).toBe(true);
    expect(isConvertibleImage("image/svg+xml")).toBe(false);
    expect(isConvertibleImage("video/mp4")).toBe(false);
  });

  it("appends to an address that already has a query", () => {
    expect(withImageFormat("/p/x/300x250?v=1", "jpg", enc(70, 256))).toBe("/p/x/300x250?v=1&as=jpg&q=70");
    expect(withImageFormat("/share/s/file/f", "webp", enc(70, 256))).toBe("/share/s/file/f?as=webp");
    expect(withImageFormat("/share/s/file/f", "gif", enc(70, 64))).toBe(
      "/share/s/file/f?as=gif&colors=64",
    );
  });
});
