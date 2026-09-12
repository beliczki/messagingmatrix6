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

/**
 * Which products a share covers, read out of its own snapshot.
 *
 * A share carries no product column — it is a frozen set of creatives and
 * matrix cells — so the dashboard's product filter has to read it back out of
 * the snapshot. Creatives name their product outright. Messages do not: the
 * snapshot stores the row as it was, and the canonical product expression
 * (`coalesce(audiences.product, split_part(topic,'_','1'))`) needs the audience
 * row, which the snapshot never captured. The topic prefix is the same
 * fallback that expression ends on, and it is what the topic keys are built
 * from, so it holds for every cell a share can contain.
 *
 * A share whose snapshot names no product at all returns an empty list, and a
 * product filter then correctly hides it — the same way audit rows with no
 * product dimension drop out of the activity digest.
 */
export function shareProducts(raw: string | null): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  try {
    const parsed = JSON.parse(raw) as {
      creatives?: { product?: unknown }[];
      messages?: { product?: unknown; topic?: unknown }[];
    };
    for (const c of Array.isArray(parsed.creatives) ? parsed.creatives : []) {
      if (typeof c?.product === "string" && c.product) out.add(c.product);
    }
    for (const m of Array.isArray(parsed.messages) ? parsed.messages : []) {
      if (typeof m?.product === "string" && m.product) {
        out.add(m.product);
        continue;
      }
      if (typeof m?.topic === "string" && m.topic.includes("_")) {
        out.add(m.topic.split("_")[0]!);
      }
    }
  } catch {
    return [];
  }
  return [...out];
}
