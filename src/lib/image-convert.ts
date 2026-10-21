import sharp, { type Sharp } from "sharp";
import type { ImageEncoding, ImageFormat } from "@/lib/image-formats";

const CONTENT_TYPES: Record<ImageFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
};

// Re-encodes a stored picture for a share download. JPG takes a quality and
// GIF a palette size; WebP and AVIF keep sharp's defaults (user decisions,
// 2026-10-21). JPG has no alpha channel, so a transparent banner is laid on
// white rather than on the black sharp would otherwise leave behind.
export async function convertImage(
  bytes: Buffer,
  as: ImageFormat,
  enc: ImageEncoding,
): Promise<{ bytes: Buffer; contentType: string }> {
  const img = sharp(bytes);
  const out =
    as === "jpg"
      ? img.flatten({ background: "#ffffff" }).jpeg({ quality: enc.jpgQuality })
      : as === "png"
        ? img.png()
        : as === "webp"
          ? img.webp()
          : as === "avif"
            ? img.avif()
            : gifWithPalette(img, enc.gifColors);
  return { bytes: await out.toBuffer(), contentType: CONTENT_TYPES[as] };
}

// sharp turns `colours` into a bit depth rounded up to a power of two — the
// rule PNG needs (1, 2, 4, 8 bits) — so 32, 64, 128 and 256 colours all come
// out as 8 bits, 256 colours. libvips' GIF encoder takes any depth from 1 to 8,
// so the exact one (log2 of the palette) is set on the options sharp hands it.
// That field is sharp's own, not its API: image-convert.test.ts counts the
// colours in the output, so an upgrade that moves it fails there, not quietly.
function gifWithPalette(img: Sharp, colours: number): Sharp {
  const out = img.gif({ colours });
  (out as unknown as { options: { gifBitdepth: number } }).options.gifBitdepth =
    Math.log2(colours);
  return out;
}
