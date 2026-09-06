/**
 * A multi-segment filter count (e.g. DCO · Agentic · creatives per product) may
 * carry a segment that is zero for every option — Erste has no channel
 * audiences, so its Agentic column reads 0 down the whole menu and only invites
 * the question "what is that middle zero?". Segments like that are dropped,
 * and reappear on their own once the data exists.
 *
 * The last surviving segment is never dropped: a menu of blank counts would be
 * worse than a menu of zeros.
 */
export function trimEmptyCountSegments(
  counts: Record<string, number[]>,
  labels: string[],
): { counts: Record<string, number[]>; labels: string[] } {
  const rows = Object.values(counts);
  if (rows.length === 0) return { counts, labels };

  const keep = labels.map((_, i) => rows.some((r) => (r[i] ?? 0) !== 0));
  if (!keep.some(Boolean)) keep[0] = true;
  if (keep.every(Boolean)) return { counts, labels };

  const out: Record<string, number[]> = {};
  for (const [key, row] of Object.entries(counts)) {
    out[key] = row.filter((_, i) => keep[i]);
  }
  return { counts: out, labels: labels.filter((_, i) => keep[i]) };
}
