// A share gallery stores its snapshot as JSON in `metadata`; the item count is
// read from it in two places (the shares list API and the dashboard summary),
// so the shape knowledge lives here rather than in whichever route needed it
// first.

type SnapshotShape = {
  messages?: unknown;
  matrixItems?: unknown;
  creatives?: unknown;
};

/** Items captured in a share: matrix cells (or plain messages) plus creatives. */
export function shareItemCount(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as SnapshotShape;
    const m = Array.isArray(parsed.matrixItems)
      ? parsed.matrixItems.length
      : Array.isArray(parsed.messages)
        ? parsed.messages.length
        : 0;
    const c = Array.isArray(parsed.creatives) ? parsed.creatives.length : 0;
    return m + c;
  } catch {
    return 0;
  }
}
