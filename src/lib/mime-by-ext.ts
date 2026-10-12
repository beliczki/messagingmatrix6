import path from "node:path";

// Content-Type by file extension for files served out of a FOLDER — template
// files and the entries of an uploaded HTML5 package. Both are web bundles, so
// one map: a package that ships a font or a sound gets the same answer a
// template would.
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  // Self-hosted webfonts. octet-stream works only because the @font-face
  // format() hint carries the type — name it properly instead of relying on that.
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

export function mimeByExt(fileName: string): string {
  return MIME[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}
