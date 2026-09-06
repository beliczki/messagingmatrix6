// Brief links (the Google Slides deck a draft came in on). Briefs store the
// Drive FILE ID, not the URL that was pasted — the same deck arrives as
// /presentation/d/<id>/edit, with a #slide=id.g123 fragment, with a ?usp=sharing
// suffix, through a /u/0/ account prefix, and sometimes as a plain Drive file
// link. Several drafts point at one brief, so three spellings of one deck would
// read as three briefs and split the group. Same reasoning, and the same shape,
// as drive-link.ts for delivery folders (I4).

/** Drive ids are opaque base64url-ish strings; real ones run 28-44 chars. */
const ID = "[A-Za-z0-9_-]{10,}";

// Any Google editor doc, plus the plain Drive file form. A brief is normally a
// presentation, but the deck is just as often shared through its Drive link,
// and both spellings carry the same id — which is exactly why the id is what
// gets stored.
const FILE_PATTERNS = [
  new RegExp(`/(?:presentation|document|spreadsheets|file)/(?:u/\\d+/)?d/(${ID})`),
  new RegExp(`/d/(${ID})`),
  new RegExp(`[?&]id=(${ID})`), // legacy /open?id=
];

const BARE_ID = new RegExp(`^${ID}$`);

/**
 * Brief link (or bare id) -> Drive file id.
 *
 * A FOLDER link returns null so the caller can say "that is a folder, paste the
 * deck" rather than storing a folder id in a file column — the mistake the
 * delivery-folder parser guards against in the other direction.
 */
export function parseSlidesFileId(
  input: string | null | undefined,
): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (BARE_ID.test(s)) return s;
  if (/\/folders\//.test(s)) return null;
  for (const re of FILE_PATTERNS) {
    const m = s.match(re);
    if (m) return m[1]!;
  }
  return null;
}

export function slidesUrl(id: string | null | undefined): string | null {
  return id ? `https://docs.google.com/presentation/d/${id}/edit` : null;
}

// The SLIDE within a brief deck, kept separate from the file id above on
// purpose: `parseSlidesFileId` deliberately throws the fragment away, because a
// brief is ONE deck however it was linked, and folding the slide into its
// identity would split one brief into one-per-slide. The anchor is per CARD
// (messages.brief_slide_id) — several cards are briefed on different slides of
// the same deck.
//
// A Slides deep link carries the page as `#slide=id.<objectId>`; the object id
// is what both the editor URL and the embed URL want back, so it is stored raw
// rather than re-wrapped in the `id.` prefix.
const SLIDE_ANCHOR_RE = /[#&?]slide=(?:id\.)?([A-Za-z0-9_-]+)/;

/**
 * Brief link -> the page object id it points at, or null when the link names
 * no slide (the plain deck URL). Null is not an error: it means "the deck",
 * and the preview then opens at the first slide instead of guessing one.
 */
export function parseSlideAnchor(
  input: string | null | undefined,
): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const m = s.match(SLIDE_ANCHOR_RE);
  return m ? m[1]! : null;
}

/**
 * The embed URL for one slide of a deck. Google serves `/embed` to anyone the
 * deck is shared with — the same "anyone with the link" shape the delivery
 * folders rely on — so a deck shared more narrowly renders a permission notice
 * inside the frame rather than the slide. That is the honest failure: it is
 * visible, and it names the fix.
 */
export function slidesEmbedUrl(
  fileId: string | null | undefined,
  slideId?: string | null,
): string | null {
  if (!fileId) return null;
  const params = new URLSearchParams({
    start: "false",
    loop: "false",
    delayms: "60000",
  });
  if (slideId) params.set("slide", `id.${slideId}`);
  return `https://docs.google.com/presentation/d/${fileId}/embed?${params.toString()}`;
}
