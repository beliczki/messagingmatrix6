// The filename a feed-export download produces. Shared on purpose: the Feeds
// list shows this string in its first column, so it must be the same value the
// download route puts in Content-Disposition — two independent format strings
// would drift the moment either changes.
//
// Deliberately dependency-free (no db import) so a client component can use it.
export function feedExportFilename(
  clientKey: string,
  product: string,
  feedVersion: number,
  id: number,
): string {
  return `${clientKey}-${product}-feed-v${feedVersion}-${id}.xlsx`;
}
