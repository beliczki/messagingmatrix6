// The Download all zip is named after the share, not "share-bundle.zip"
// (user request, 2026-10-21): accents folded to plain ASCII (á → a, ő → o),
// spaces to `_`, and the number of files it holds at the end —
// "Bird VALL és MASS remarketing v2" with two files is
// "Bird_VALL_es_MASS_remarketing_v2-bundleOf2.zip".
export function shareBundleName(title: string | null, fileCount: number): string {
  const base = (title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Characters a file system refuses or a zip tool mangles.
    .replace(/[\\/:*?"<>|]+/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return `${base || "share"}-bundleOf${fileCount}.zip`;
}
