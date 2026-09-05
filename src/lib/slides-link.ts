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
