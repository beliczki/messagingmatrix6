// The formats a share viewer can ask a video to be converted into (`?as=webm`
// on /share/[id]/file). Client-safe like image-formats.ts: the download menus
// read the label, the route parses the same param, and the encode itself lives
// server-side in video-convert.ts.

export const VIDEO_FORMATS = ["webm"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  webm: "WebM",
};

export function parseVideoFormat(raw: string | null): VideoFormat | null {
  return (VIDEO_FORMATS as readonly string[]).includes(raw ?? "")
    ? (raw as VideoFormat)
    : null;
}

/** A video ffmpeg can re-encode into WebM. One that already is WebM stays as it is. */
export function isConvertibleVideo(mimeType: string | null | undefined): boolean {
  return (mimeType?.startsWith("video/") ?? false) && mimeType !== "video/webm";
}

/** The same address, asking for the video in another format. */
export function withVideoFormat(url: string, as: VideoFormat): string {
  return `${url}${url.includes("?") ? "&" : "?"}as=${as}`;
}
