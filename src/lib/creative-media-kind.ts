import { mediaKindFromFilename } from "./parse-filename";

/** The mime every stored HTML5 package carries (normalized at upload). */
export const HTML5_PACKAGE_MIME = "application/zip";

export type CreativeMediaKind = "image" | "video" | "html5" | "other";

/**
 * What an uploaded creative IS, for every surface that shows one: the library
 * tiles, draft covers, the editor preview, the matrix cell, the share. One
 * answer in one place — the surfaces each used to test `startsWith("image/")`
 * and treat everything else that wasn't a video as a picture, which is how a
 * zip ended up in an <img>.
 *
 * The stored mime decides (the upload normalizes it); a creative known only by
 * name (a matrix cell's image1, a Drive-linked row) falls back to the name.
 */
export function creativeMediaKind(
  mimeType: string | null | undefined,
  fileName?: string | null,
): CreativeMediaKind {
  if (mimeType) {
    if (mimeType === HTML5_PACKAGE_MIME) return "html5";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    return "other";
  }
  if (!fileName) return "other";
  if (/\.zip$/i.test(fileName)) return "html5";
  const kind = mediaKindFromFilename(fileName);
  return kind === "image" || kind === "video" ? kind : "other";
}
