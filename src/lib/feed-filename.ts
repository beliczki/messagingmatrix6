// The filename a feed-export download produces. Shared on purpose: the Feeds
// list shows this string in its first column, so it must be the same value the
// download route puts in Content-Disposition — two independent format strings
// would drift the moment either changes.
//
// Deliberately dependency-free (no db import) so a client component can use it.
// The platform sits in the name because a split export produces two files for
// the same product and version at the same moment; without it they would differ
// only by the trailing id, and picking the wrong one to upload is exactly the
// mistake this whole feature exists to prevent.
export function feedExportFilename(
  clientKey: string,
  product: string,
  platform: string,
  feedVersion: number,
  // null before the row exists: the export dialog names the file it is about to
  // build, and the id is only assigned on insert. "new" says that plainly
  // instead of showing a 0 that looks like a real id.
  id: number | null,
): string {
  return `${clientKey}-${product}-${platform}-feed-v${feedVersion}-${id ?? "new"}.xlsx`;
}

// An uploaded AdForm reference has no generated name — it is somebody's file,
// and that is the name they will look for in the list. It is kept in the notes
// column ("Uploaded from AdForm: <name>") rather than a column of its own,
// which predates this helper; parsing it in one place keeps the format from
// being re-derived at every call site.
export const SNAPSHOT_NOTES_PREFIX = "Uploaded from AdForm:";

export function filenameFromNotes(notes: string | null): string {
  if (!notes) return "";
  const m = notes.match(/^Uploaded from AdForm:\s*(.*)$/);
  return m ? m[1] : notes;
}

/**
 * What the File column shows: the uploaded file's own name for a reference,
 * the generated download name for an export.
 */
export function feedExportDisplayName(row: {
  id: number;
  product: string;
  platform: string;
  feedVersion: number;
  source: string;
  notes: string | null;
}, clientKey: string): string {
  if (row.source === "adform_snapshot") {
    const uploaded = filenameFromNotes(row.notes);
    if (uploaded) return uploaded;
  }
  return feedExportFilename(
    clientKey,
    row.product,
    row.platform,
    row.feedVersion,
    row.id,
  );
}
