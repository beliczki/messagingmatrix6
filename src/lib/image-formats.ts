// The image formats a share viewer can ask a picture to be converted into
// (`?as=<format>` on /share/[id]/file and on the /publicshortcut preview PNG).
// Client-safe on purpose: the download menus read the list and the labels, the
// routes parse the same params, and the encoding itself lives server-side in
// image-convert.ts — browsers cannot encode AVIF from a canvas.

export const IMAGE_FORMATS = ["jpg", "png", "webp", "avif", "gif"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  jpg: "JPG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
  gif: "GIF",
};

export const DEFAULT_JPG_QUALITY = 70;

// A GIF holds at most 256 colours; the viewer picks how many (user request,
// 2026-10-21) — fewer is a smaller file and a coarser picture.
export const GIF_PALETTES = [32, 64, 128, 256] as const;
export const DEFAULT_GIF_COLORS = 256;

/** The per-format knobs a conversion takes; each format reads its own. */
export type ImageEncoding = { jpgQuality: number; gifColors: number };

export function parseImageFormat(raw: string | null): ImageFormat | null {
  return (IMAGE_FORMATS as readonly string[]).includes(raw ?? "")
    ? (raw as ImageFormat)
    : null;
}

/** 1–100; anything else (missing, garbage) is the default. */
export function parseJpgQuality(raw: string | null): number {
  const n = Number(raw);
  if (raw === null || !Number.isInteger(n) || n < 1 || n > 100) {
    return DEFAULT_JPG_QUALITY;
  }
  return n;
}

/** One of GIF_PALETTES; anything else is the default. */
export function parseGifColors(raw: string | null): number {
  const n = Number(raw);
  return (GIF_PALETTES as readonly number[]).includes(n) ? n : DEFAULT_GIF_COLORS;
}

/** The `q` and `colors` params of a conversion request. */
export function parseImageEncoding(params: URLSearchParams): ImageEncoding {
  return {
    jpgQuality: parseJpgQuality(params.get("q")),
    gifColors: parseGifColors(params.get("colors")),
  };
}

/** A raster image sharp can re-encode. SVG is vector and stays as it is. */
export function isConvertibleImage(mimeType: string | null | undefined): boolean {
  return (mimeType?.startsWith("image/") ?? false) && mimeType !== "image/svg+xml";
}

/** The format a filename already is, so the menu can leave that row out. */
export function formatOfFilename(name: string): ImageFormat | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return parseImageFormat(ext === "jpeg" ? "jpg" : ext);
}

/** The same address, asking for the image in another format. */
export function withImageFormat(url: string, as: ImageFormat, enc: ImageEncoding): string {
  const knob =
    as === "jpg" ? `&q=${enc.jpgQuality}` : as === "gif" ? `&colors=${enc.gifColors}` : "";
  return `${url}${url.includes("?") ? "&" : "?"}as=${as}${knob}`;
}
