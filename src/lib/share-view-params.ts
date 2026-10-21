// A share's view, carried in its link (user request, 2026-10-21):
//
//   /share/<id>?theme=dark&layout=grid&size=300x250,300x600&q=hitelkártya&commented&image
//
// Both ways: the link sets the view the gallery opens with, and the gallery
// writes what the viewer changes back into the address bar, so a copied
// address hands on the view as it is. Only what differs from the default is
// written — a fresh share's link stays a bare /share/<id>. Switches carry no
// value (`&commented`, not `&commented=true`). Client-safe: the page parses on
// the server, the gallery serializes in the browser.

export type ShareLayout = "grid" | "list" | "masonry";

export type ShareViewState = {
  /** null = the viewer's own theme; a link only overrides it for that visit. */
  theme: "dark" | "light" | null;
  layout: ShareLayout;
  sizes: string[];
  q: string;
  commented: boolean;
  image: boolean;
};

export const DEFAULT_SHARE_VIEW: ShareViewState = {
  theme: null,
  layout: "masonry",
  sizes: [],
  q: "",
  commented: false,
  image: false,
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseShareView(raw: RawParams): ShareViewState {
  const theme = first(raw.theme);
  const layout = first(raw.layout);
  return {
    theme: theme === "dark" || theme === "light" ? theme : null,
    layout: layout === "grid" || layout === "list" ? layout : "masonry",
    sizes: (first(raw.size) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
    q: first(raw.q) ?? "",
    commented: raw.commented !== undefined,
    image: raw.image !== undefined,
  };
}

// Percent-encode only what has to be: a comma, a colon or a slash reads fine
// in a query and is what the filter language is made of (`mc:141c`), and a
// space is a `+`. Accented letters stay encoded on the wire; the address bar
// shows them decoded.
function encode(v: string): string {
  return encodeURIComponent(v)
    .replace(/%2C/gi, ",")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%20/g, "+");
}

/** "" when the view is the default, otherwise "?…" with the non-defaults. */
export function serializeShareView(v: ShareViewState): string {
  const parts: string[] = [];
  if (v.theme) parts.push(`theme=${v.theme}`);
  if (v.layout !== DEFAULT_SHARE_VIEW.layout) parts.push(`layout=${v.layout}`);
  if (v.sizes.length > 0) parts.push(`size=${encode(v.sizes.join(","))}`);
  if (v.q.trim() !== "") parts.push(`q=${encode(v.q)}`);
  if (v.commented) parts.push("commented");
  if (v.image) parts.push("image");
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
