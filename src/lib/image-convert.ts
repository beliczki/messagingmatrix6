import sharp from "sharp";
import type { ImageFormat } from "@/lib/image-formats";

const CONTENT_TYPES: Record<ImageFormat, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

// Re-encodes a stored picture for a share download. Only JPG takes a quality —
// WebP and AVIF keep sharp's defaults (user decision, 2026-10-21). JPG has no
// alpha channel, so a transparent banner is laid on white rather than on the
// black sharp would otherwise leave behind.
export async function convertImage(
  bytes: Buffer,
  as: ImageFormat,
  jpgQuality: number,
): Promise<{ bytes: Buffer; contentType: string }> {
  const img = sharp(bytes);
  const out =
    as === "jpg"
      ? img.flatten({ background: "#ffffff" }).jpeg({ quality: jpgQuality })
      : as === "png"
        ? img.png()
        : as === "webp"
          ? img.webp()
          : img.avif();
  return { bytes: await out.toBuffer(), contentType: CONTENT_TYPES[as] };
}
