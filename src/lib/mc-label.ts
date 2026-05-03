// Stable "MC{number}{variant}" label used by both the banner renderer and
// the feed-export pipeline to match text-formatting rules' formattingMcScope.

export function mcLabelFor(message: Record<string, unknown>): string {
  const n = message.number ?? message.Number;
  const v = message.variant ?? message.Variant;
  if (n === null || n === undefined || !v) return "";
  return `MC${n}${v}`;
}
