// The image formats a share viewer can ask a picture to be converted into
// (`?as=<format>` on /share/[id]/file and on the /publicshortcut preview PNG).
// Client-safe on purpose: the download menus read the list and the labels, the
// routes parse the same params, and the encoding itself lives server-side in
// image-convert.ts — browsers cannot encode AVIF from a canvas.

export const IMAGE_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = {
  jpg: "JPG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
};

export const DEFAULT_JPG_QUALITY = 70;

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
export function withImageFormat(url: string, as: ImageFormat, quality: number): string {
  const q = as === "jpg" ? `&q=${quality}` : "";
  return `${url}${url.includes("?") ? "&" : "?"}as=${as}${q}`;
}
