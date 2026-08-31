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
  id: number,
): string {
  return `${clientKey}-${product}-${platform}-feed-v${feedVersion}-${id}.xlsx`;
}
