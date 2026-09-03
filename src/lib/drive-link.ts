// Google Drive delivery links (I4). Creatives store Drive *ids*, not the URL
// the user pasted: the same folder arrives as /drive/folders/<id>, with a
// ?usp=sharing suffix, or via a /u/0/ account prefix, and the share header
// groups creatives by folder — raw strings would split one folder into three.

/** Drive ids are opaque base64url-ish strings; real ones run 28-44 chars. */
const ID = "[A-Za-z0-9_-]{10,}";

const FOLDER_PATTERNS = [
  new RegExp(`/folders/(${ID})`),
  new RegExp(`[?&]id=(${ID})`), // legacy /open?id=
];

const FILE_PATTERNS = [
  new RegExp(`/file/d/(${ID})`),
  new RegExp(`/uc\\?(?:[^#]*&)?id=(${ID})`),
  new RegExp(`[?&]id=(${ID})`), // legacy /open?id=
];

const BARE_ID = new RegExp(`^${ID}$`);

function firstMatch(input: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = input.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Folder link (or bare id) -> folder id. A *file* link returns null so the
 *  caller can say "this is a file link, paste the folder" instead of storing
 *  a file id in the folder column. */
export function parseDriveFolderId(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (BARE_ID.test(s)) return s;
  if (/\/file\/d\//.test(s)) return null;
  return firstMatch(s, FOLDER_PATTERNS);
}

/** File link (or bare id) -> file id. A *folder* link returns null. */
export function parseDriveFileId(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (BARE_ID.test(s)) return s;
  if (/\/folders\//.test(s)) return null;
  return firstMatch(s, FILE_PATTERNS);
}

export function driveFolderUrl(id: string | null | undefined): string | null {
  return id ? `https://drive.google.com/drive/folders/${id}` : null;
}

export function driveFileUrl(id: string | null | undefined): string | null {
  return id ? `https://drive.google.com/file/d/${id}/view` : null;
}
