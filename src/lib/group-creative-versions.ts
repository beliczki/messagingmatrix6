// Groups uploaded creatives whose filenames differ only in the _nN version
// token (v1 usually has no token) into version families. The key is derived
// from the filename — familyKey + DECLARED size — because the stored
// family_key is null for UI uploads, actual file_dimensions can differ between
// versions of the same declared size (160x600 vs 161x600 retina crops), and
// the extension can change across versions (jpg → png). The creatives.version
// column is NOT used: the app increments it as an optimistic-concurrency
// counter on every PATCH, so only the filename's _nN token is authoritative.

import { parseCreativeFilename } from "./parse-creative-filename";

export type VersionGroup<T> = {
  groupKey: string;
  latest: T;
  versions: T[]; // oldest → newest; latest === versions[versions.length - 1]
};

type GroupableCreative = {
  id: number;
  fileName: string | null;
  createdAt: string;
};

/**
 * The bucket a filename belongs to: same campaign, same declared size — the
 * files that are versions of each other. Exported so the upload dialog can tell
 * you a dropped file is a new version of something you already have, using the
 * exact key the grouping itself uses. Two answers from two derivations of "same
 * family" would eventually disagree, and the disagreement would show up as a
 * file that promised to replace a version and then sat beside it.
 */
export function versionFamilyKey(
  fileName: string,
): { key: string; version: number } | null {
  const parsed = parseCreativeFilename(fileName);
  if (!parsed.familyKey) return null;
  return {
    key: `${parsed.familyKey.toLowerCase()}|${parsed.declaredDimensions ?? ""}`,
    version: parsed.version,
  };
}

export function groupCreativeVersions<T extends GroupableCreative>(
  rows: readonly T[],
): VersionGroup<T>[] {
  const buckets = new Map<string, { row: T; version: number }[]>();

  for (const row of rows) {
    let key: string;
    let version = 1;
    if (row.fileName) {
      const family = versionFamilyKey(row.fileName);
      key = family ? family.key : `id:${row.id}`;
      version = family ? family.version : 1;
    } else {
      key = `id:${row.id}`;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ row, version });
    else buckets.set(key, [{ row, version }]);
  }

  const out: VersionGroup<T>[] = [];
  for (const [groupKey, bucket] of buckets) {
    bucket.sort((a, b) => {
      if (a.version !== b.version) return a.version - b.version;
      const at = Date.parse(a.row.createdAt);
      const bt = Date.parse(b.row.createdAt);
      if (at !== bt) return at - bt;
      return a.row.id - b.row.id;
    });
    const versions = bucket.map((e) => e.row);
    out.push({ groupKey, latest: versions[versions.length - 1]!, versions });
  }
  return out;
}
