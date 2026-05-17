// Folder-driven creative filename parser. Splits a filename like
//   ERSTE_SZA_MC289_a_diakszamla_2026Q1_fullImage_n3_640x360.jpg
// into structured metadata for the creatives table.
//
// Conventions observed in the Erste inbox folder:
//   token 0  → brand (ERSTE)
//   token 1  → product (SZA / SZK / HITEL / MARKET / HK / LTP / VAL …)
//   token 2  → optional MC marker: "MC<digits>" | "MC" | "MCx"
//   token 3  → optional single-letter MC variant (a/b/c/A/B/C) — only if token 2
//              starts with "MC"
//   middle   → keywords (joined with " ")
//   _nN_     → version number (default 1 if missing)
//   _WxH(px)?_ext → declared dimensions + extension
//
// familyKey = the stem with _nN_ and _WxH_ stripped. All files with the same
// familyKey (same campaign, all sizes + all versions) belong together; the
// matrix should later render max(version) per family per requested size.

const EXT_TYPE: Record<string, "image" | "video" | "html" | "pdf"> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  html: "html",
  zip: "html",
  pdf: "pdf",
};

export type ParsedCreative = {
  brand: string | null;
  product: string | null;
  mcNumber: number | null;
  mcVariant: string | null;
  keywords: string;
  version: number;
  declaredDimensions: string | null;
  ext: string;
  type: "image" | "video" | "html" | "pdf" | null;
  familyKey: string;
};

function stripExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i + 1).toLowerCase() };
}

// `1080x1080`, `1080x1080px` — captures W and H even with the trailing "px".
const DIM_AT_END_RE = /_(\d{2,5})x(\d{2,5})(?:px)?$/i;
const VERSION_RE = /_n(\d{1,3})(?=_|$)/i;
const MC_NUMBER_RE = /^MC(\d+)$/i;
const MC_PLACEHOLDER_RE = /^MCx?$/i;
const VARIANT_RE = /^[a-z]$/i;

export function parseCreativeFilename(filename: string): ParsedCreative {
  const { stem, ext } = stripExt(filename);
  const type = EXT_TYPE[ext] ?? null;

  // Pull dimensions off the end of the stem first.
  let working = stem;
  let declaredDimensions: string | null = null;
  const dimMatch = working.match(DIM_AT_END_RE);
  if (dimMatch) {
    declaredDimensions = `${dimMatch[1]}x${dimMatch[2]}`;
    working = working.slice(0, dimMatch.index);
  }

  // Pull version `_nN_` from what remains (matches at end too thanks to lookahead).
  let version = 1;
  const verMatch = working.match(VERSION_RE);
  if (verMatch) {
    version = parseInt(verMatch[1]!, 10) || 1;
    working = working.slice(0, verMatch.index) + working.slice(verMatch.index! + verMatch[0].length);
    // Collapse any double underscores caused by the snip.
    working = working.replace(/__+/g, "_").replace(/_$/g, "");
  }

  // familyKey = stem with _nN_ and _WxH_ stripped (= working at this point).
  const familyKey = working;

  // Tokenise the remainder.
  const tokens = working.split("_").filter((t) => t.length > 0);
  const brand = tokens[0] ?? null;
  const product = tokens[1] ?? null;

  let mcNumber: number | null = null;
  let mcVariant: string | null = null;
  let keywordStart = 2;

  if (tokens.length > 2) {
    const t2 = tokens[2]!;
    const mcN = t2.match(MC_NUMBER_RE);
    if (mcN) {
      mcNumber = parseInt(mcN[1]!, 10);
      keywordStart = 3;
      if (tokens[3] && VARIANT_RE.test(tokens[3])) {
        mcVariant = tokens[3]!.toLowerCase();
        keywordStart = 4;
      }
    } else if (MC_PLACEHOLDER_RE.test(t2)) {
      // "MC" or "MCx" → no number, but a variant may follow.
      keywordStart = 3;
      if (tokens[3] && VARIANT_RE.test(tokens[3])) {
        mcVariant = tokens[3]!.toLowerCase();
        keywordStart = 4;
      }
    }
  }

  const keywords = tokens.slice(keywordStart).join(" ");

  return {
    brand,
    product,
    mcNumber,
    mcVariant,
    keywords,
    version,
    declaredDimensions,
    ext,
    type,
    familyKey,
  };
}
