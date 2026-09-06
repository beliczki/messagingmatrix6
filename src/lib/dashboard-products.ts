import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  audiences,
  creatives,
  messages,
  textFormatting,
  topics,
} from "@/db/schema";
import { trimEmptyCountSegments } from "@/lib/count-segments";

export type ProductInventory = {
  /** Per product, one number per surviving segment of PRODUCT_COUNT_LABELS. */
  counts: Record<string, number[]>;
  /** Names of the segments actually present in `counts`. */
  labels: string[];
  options: string[];
};

export const PRODUCT_COUNT_LABELS = ["DCO", "Agentic", "creatives"];

/**
 * Product inventory for the filter menu: how many DCO cells, Agentic cells and
 * delivered creatives each product has.
 *
 * Whole library, not the window — a product picker is read to decide where to
 * look, so the numbers must not collapse to zero on a quiet day. DCO/Agentic is
 * the audience partition the matrix axis uses (channel == null vs not), and a
 * Agentic cell takes its product from the topic key prefix, since those channel
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
      // The dashboard reports on the matrix, and a DRAFT is not in it yet: no
      // audience means no product, so nothing to count it under.
      .select({ audience: messages.audience, topic: messages.topic })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          isNull(messages.archivedAt),
          isNotNull(messages.audience),
        ),
      ),
    db
      .select({ product: creatives.product, n: count() })
      .from(creatives)
      .where(
        and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt)),
      )
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
    // The query already excludes drafts; this restates it for the type system,
    // which types the columns from the schema rather than from the predicate.
    if (m.audience === null || m.topic === null) continue;
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

/**
 * A matrix cell's product, as SQL.
 *
 * Two sources, because a cell's column is one of two things. A DCO cell sits on
 * an audience and takes the audience's product. An Agentic cell sits on a channel
 * (`ch_disp`, `ch_soc`, …) — its own table since the 2026-08-17 split — and a
 * channel carries no product, so only the topic key prefix names one. 688 Erste
 * cells are Agentic, and a rule that branched on the audience alone would lose
 * every one of them.
 *
 * The caller must have `messages` in scope LEFT JOINed to `audiences` on
 * (key, client_id); this is an expression, not a self-contained query.
 */
export const messageProduct = sql`coalesce(${audiences.product}, split_part(${messages.topic}, '_', 1))`;

export type LibraryCounts = {
  audiences: number;
  topics: number;
  /** Distinct MC number+variant, NOT `messages` rows — see `libraryCounts`. */
  mcs: number;
  /** The rows those MCs occupy, kept as context under the MC count. */
  messageCells: number;
  assets: number;
  creatives: number;
  text_formatting: number;
};

/**
 * The "Library · all time" tile numbers, narrowed to `products` when a filter
 * is on.
 *
 * Five of the six can be scoped: audiences, topics, assets and creatives carry
 * a product column, and a message resolves through `messageProduct`. Text
 * formatting has no product dimension at all, so it is deliberately NOT
 * filtered — the tile says "all products" instead, which is truer than either
 * dropping it to zero (the rows do exist) or letting it look filtered when it
 * is not.
 *
 * The matrix figure counts DISTINCT MC number+variant, not `messages` rows. A
 * row is a cell, and one MC lives in as many cells as it has audiences — MC316a
 * occupies 43 of them — so the row count answers "how many times is the same
 * message duplicated across audiences", which is not a library size. Erste:
 * 2,753 rows, 635 MCs. The row count rides along as context.
 */
export async function libraryCounts(
  clientId: number,
  products: string[] = [],
): Promise<LibraryCounts> {
  const p = products.length > 0;
  const c = await Promise.all([
    db
      .select({ n: count() })
      .from(audiences)
      .where(
        and(
          eq(audiences.clientId, clientId),
          p ? inArray(audiences.product, products) : undefined,
        ),
      ),
    db
      .select({ n: count() })
      .from(topics)
      .where(
        and(
          eq(topics.clientId, clientId),
          // Same fallback the activity digest uses: two Erste topics have no
          // product column value, and their key prefix names it.
          p
            ? inArray(
                sql`coalesce(${topics.product}, split_part(${topics.key}, '_', 1))`,
                products,
              )
            : undefined,
        ),
      ),
    db
      .select({
        n: sql<number>`count(distinct (${messages.number}, ${messages.variant}))::int`,
        cells: sql<number>`count(*)::int`,
      })
      .from(messages)
      .leftJoin(
        audiences,
        and(
          eq(audiences.key, messages.audience),
          eq(audiences.clientId, messages.clientId),
        ),
      )
      .where(
        and(
          eq(messages.clientId, clientId),
          p ? inArray(messageProduct, products) : undefined,
        ),
      ),
    db
      .select({ n: count() })
      .from(assets)
      .where(
        and(
          eq(assets.clientId, clientId),
          p ? inArray(assets.product, products) : undefined,
        ),
      ),
    db
      .select({ n: count() })
      .from(creatives)
      .where(
        and(
          eq(creatives.clientId, clientId),
          p ? inArray(creatives.product, products) : undefined,
        ),
      ),
    db
      .select({ n: count() })
      .from(textFormatting)
      .where(eq(textFormatting.clientId, clientId)),
  ]);
  return {
    audiences: c[0][0]?.n ?? 0,
    topics: c[1][0]?.n ?? 0,
    mcs: c[2][0]?.n ?? 0,
    messageCells: c[2][0]?.cells ?? 0,
    assets: c[3][0]?.n ?? 0,
    creatives: c[4][0]?.n ?? 0,
    text_formatting: c[5][0]?.n ?? 0,
  };
}
