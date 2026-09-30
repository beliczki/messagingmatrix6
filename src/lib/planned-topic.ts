// A draft's planned topic, split into and composed from the tags the topics
// dimension is keyed by. Shared by the Brief tab's composer and the promote
// route, which creates the topic those tags describe — see PlannedTopicField
// for why the two sides compose on "_".
export type Parts = { tag1: string; tag2: string; tag3: string; tag4: string };

export function splitTopic(value: string | null, product: string | null): Parts {
  const empty = { tag1: "", tag2: "", tag3: "", tag4: "" };
  if (!value) return empty;
  let rest = value;
  // The product prefix belongs to the key, not to the tags — drop it so the
  // pickers show what the user actually chose.
  if (product && rest.toUpperCase().startsWith(`${product.toUpperCase()}_`)) {
    rest = rest.slice(product.length + 1);
  }
  const parts = rest.split("_");
  return {
    tag1: parts[0] ?? "",
    tag2: parts[1] ?? "",
    tag3: parts[2] ?? "",
    // Everything left, joined back: tag4 is free text and may carry underscores
    // of its own.
    tag4: parts.slice(3).join("_"),
  };
}

// POSITION-PRESERVING, and that is not a detail: dropping the empty parts made
// "tag4 = t" compose to `MARKET_t`, which reads back as tag1 = "t" — the
// character typed into the last field reappeared in the first one, and the
// caret went with it. Empty slots stay as empty segments (`MARKET____t`), which
// is also exactly what the stored key pattern produces for the same input.
// Trailing empties are dropped, since nothing follows them to hold a position.
export function joinTopic(product: string | null, p: Parts): string {
  const parts = [product ?? "", p.tag1, p.tag2, p.tag3, p.tag4].map((s) =>
    (s ?? "").trim(),
  );
  while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.join("_");
}

export type TopicTags = {
  product: string | null;
  tag1: string | null;
  tag2: string | null;
  tag3: string | null;
  tag4: string | null;
};

/**
 * The topics-dimension row a planned topic describes, or null when it names no
 * tag at all. Empty slots become null, which is what an untagged column holds.
 */
export function plannedTopicTags(
  planned: string | null,
  product: string | null,
): TopicTags | null {
  const p = splitTopic(planned, product);
  const tags = {
    product,
    tag1: p.tag1.trim() || null,
    tag2: p.tag2.trim() || null,
    tag3: p.tag3.trim() || null,
    tag4: p.tag4.trim() || null,
  };
  return tags.tag1 || tags.tag2 || tags.tag3 || tags.tag4 ? tags : null;
}

/** Does this topic already carry exactly these tags? Keys can drift from their
 *  tags (a frozen key), so the tags — not the key — decide "already exists". */
export function hasTopicTags(t: TopicTags, tags: TopicTags): boolean {
  const same = (a: string | null, b: string | null) =>
    (a ?? "").toUpperCase() === (b ?? "").toUpperCase();
  return (
    same(t.product, tags.product) &&
    same(t.tag1, tags.tag1) &&
    same(t.tag2, tags.tag2) &&
    same(t.tag3, tags.tag3) &&
    same(t.tag4, tags.tag4)
  );
}
