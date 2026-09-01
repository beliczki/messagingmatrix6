import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { audiences, creatives, messages } from "@/db/schema";
import { trimEmptyCountSegments } from "@/lib/count-segments";

export type ProductInventory = {
  /** Per product, one number per surviving segment of PRODUCT_COUNT_LABELS. */
  counts: Record<string, number[]>;
  /** Names of the segments actually present in `counts`. */
  labels: string[];
  options: string[];
};

export const PRODUCT_COUNT_LABELS = ["DCO", "nonDCO", "creatives"];

/**
 * Product inventory for the filter menu: how many DCO cells, nonDCO cells and
 * delivered creatives each product has.
 *
 * Whole library, not the window — a product picker is read to decide where to
 * look, so the numbers must not collapse to zero on a quiet day. DCO/nonDCO is
 * the audience partition the matrix axis uses (channel == null vs not), and a
 * nonDCO cell takes its product from the topic key prefix, since those channel
 * audiences are shared across products.
 */
export async function productInventory(
  clientId: number,
): Promise<ProductInventory> {
  const [audienceRows, messageRows, creativeRows] = await Promise.all([
    db
      .select({
        key: audiences.key,
        product: audiences.product,
        channel: audiences.channel,
      })
      .from(audiences)
      .where(eq(audiences.clientId, clientId)),
    db
      .select({ audience: messages.audience, topic: messages.topic })
      .from(messages)
      .where(and(eq(messages.clientId, clientId), isNull(messages.archivedAt))),
    db
      .select({ product: creatives.product, n: count() })
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt)))
      .groupBy(creatives.product),
  ]);

  const audienceById = new Map(audienceRows.map((a) => [a.key, a]));
  const counts: Record<string, number[]> = {};
  const bump = (product: string | null | undefined, slot: 0 | 1 | 2, n = 1) => {
    if (!product) return;
    const cur = counts[product] ?? [0, 0, 0];
    cur[slot] += n;
    counts[product] = cur;
  };
  for (const a of audienceRows) if (a.channel == null) bump(a.product, 0, 0);
  for (const m of messageRows) {
    const a = audienceById.get(m.audience);
    if (!a) continue;
    if (a.channel == null) bump(a.product, 0);
    else {
      const i = m.topic.indexOf("_");
      bump(i > 0 ? m.topic.slice(0, i) : null, 1);
    }
  }
  for (const c of creativeRows) bump(c.product, 2, c.n);

  const trimmed = trimEmptyCountSegments(counts, PRODUCT_COUNT_LABELS);
  return {
    counts: trimmed.counts,
    labels: trimmed.labels,
    options: Object.keys(counts).sort(),
  };
}
