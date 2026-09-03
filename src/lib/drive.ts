// Google Drive REST v3, read-only, authenticated with a plain API key
// (GCP project grafia-2026, key "messagingMatrix", restricted to the Drive
// API). No OAuth: the delivery folders are shared "anyone with the link", and
// an API key sees exactly what such a link sees.
//
// Two measured properties of that anonymous access shape the API here:
//   * The `parents` field is NOT returned, so a file id can never be walked
//     back to its folder. Only folder -> children works.
//   * A folder that is NOT link-shared answers files.list with an empty list,
//     not an error. Listing alone therefore cannot tell "not shared" from
//     "shared, file isn't in it" — getDriveFolder() (which 404s) is the probe
//     that separates them, and callers must report those cases differently.

const API = "https://www.googleapis.com/drive/v3/files";

export type DriveFile = { id: string; name: string; mimeType: string };
export type DriveFolder = { id: string; name: string };

/** Thrown for anything that is not a clean answer: missing key, HTTP error. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

function apiKey(): string {
  const key = process.env.GOOGLE_DRIVE_API_KEY;
  if (!key) {
    throw new DriveError(
      "GOOGLE_DRIVE_API_KEY is not set — Drive lookups are unavailable",
    );
  }
  return key;
}

async function driveFetch(
  url: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

/** Folder metadata, or null when the folder is not reachable with the key —
 *  deleted, wrong id, or (the common case) not shared "anyone with the link". */
export async function getDriveFolder(
  folderId: string,
): Promise<DriveFolder | null> {
  const url = `${API}/${encodeURIComponent(folderId)}?fields=id,name&key=${encodeURIComponent(apiKey())}`;
  const { status, body } = await driveFetch(url);
  if (status === 404) return null;
  if (status !== 200) {
    throw new DriveError(driveMessage(body, `files.get failed`), status);
  }
  return { id: String(body.id), name: String(body.name) };
}

/** Every non-trashed child of a folder. Pages to the end: Drive caps a page at
 *  1000 entries and answers a fuller folder with a nextPageToken, so a single
 *  request would silently return only the first slice. */
export async function listDriveFolder(folderId: string): Promise<DriveFile[]> {
  const key = apiKey();
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType)",
      pageSize: "1000",
      key,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const { status, body } = await driveFetch(`${API}?${params.toString()}`);
    if (status !== 200) {
      throw new DriveError(driveMessage(body, "files.list failed"), status);
    }
    for (const f of (body.files ?? []) as DriveFile[]) {
      out.push({ id: f.id, name: f.name, mimeType: f.mimeType });
    }
    pageToken = body.nextPageToken as string | undefined;
  } while (pageToken);
  return out;
}

function driveMessage(body: Record<string, unknown>, fallback: string): string {
  const err = body.error as { message?: string } | undefined;
  return err?.message ? `${fallback}: ${err.message}` : fallback;
}
