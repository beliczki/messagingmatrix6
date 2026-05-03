// Feed-view column → pattern resolution.
//
// The feedStructure CSV is the source of truth for both column ordering AND
// column naming. Whatever the user types in Settings → Structure is what gets
// stored, what's keyed in patterns.feed, and what's emitted as the AdForm
// column header. Typed prefixes like "Text:", "Asset:", "AdformSignal:", "LP:"
// are part of the column name — they round-trip verbatim. Nothing here strips,
// rewrites, or "knows about" specific column names.
//
// If a column has no entry in patterns.feed, the fallback is a placeholder
// built from the part after ":" (or the whole name if no colon), e.g.
// "Text:headline_text_1" → "{{headline_text_1}}". The user overrides this in
// Settings → Feed patterns when they want it to render a different field.

export function parseFeedColumns(feedStructure: string): string[] {
  if (!feedStructure) return [];
  return feedStructure
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function defaultFeedPattern(column: string): string {
  const colon = column.indexOf(":");
  const fieldName = colon < 0 ? column : column.slice(colon + 1);
  return `{{${fieldName.toLowerCase()}}}`;
}

export function resolveFeedPattern(
  column: string,
  feedPatterns: Record<string, string> | null | undefined,
): string {
  const explicit = feedPatterns?.[column];
  if (explicit && explicit.trim()) return explicit;
  return defaultFeedPattern(column);
}
