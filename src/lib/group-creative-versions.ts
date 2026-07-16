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

export function groupCreativeVersions<T extends GroupableCreative>(
  rows: readonly T[],
): VersionGroup<T>[] {
  const buckets = new Map<string, { row: T; version: number }[]>();

  for (const row of rows) {
    let key: string;
    let version = 1;
    if (row.fileName) {
      const parsed = parseCreativeFilename(row.fileName);
      key = parsed.familyKey
        ? `${parsed.familyKey.toLowerCase()}|${parsed.declaredDimensions ?? ""}`
        : `id:${row.id}`;
      version = parsed.version;
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
