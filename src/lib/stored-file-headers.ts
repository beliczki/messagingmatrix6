// Headers for serving an UPLOADED file's bytes. The mime type is whatever the
// uploader's browser claimed, and every route that serves these bytes runs on
// the app's own origin — so an uploaded .html or .svg opened by its URL would
// execute there, with the viewer's session cookie in reach of its fetches. A
// share link is public, and staff open share links logged in.
//
// `nosniff` stops a mislabelled file from being promoted to HTML/script by
// content sniffing. `CSP: sandbox` makes any document these bytes turn into
// run in an opaque origin with scripts off: an image, video or font embedded by
// a page is unaffected (CSP of a subresource response is not applied to it),
// only a direct top-level open of an active type is defused. PDF is the one
// exception — Chrome's PDF viewer refuses to load in a sandboxed document, and
// a PDF's own JS runs inside the viewer, not on the origin.
//
// Every route serving stored bytes takes its Content-Type from here, so the
// rule lives in one place instead of being remembered per route.
export function storedFileHeaders(
  mimeType: string | null | undefined,
): Record<string, string> {
  const contentType = mimeType ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
  if (contentType !== "application/pdf") {
    headers["Content-Security-Policy"] = "sandbox";
  }
  return headers;
}
