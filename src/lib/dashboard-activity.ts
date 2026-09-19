import { and, count, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  audiences,
  auditLog,
  creatives,
  feedExports,
  messages,
  topics,
} from "@/db/schema";
import type { DayScope } from "@/lib/day-scope";
import { messageProduct } from "@/lib/dashboard-products";

export type DigestRow = {
  entityType: string;
  action: string;
  userId: string | null;
  n: number;
};

// Aggregated, not listed: a busy day writes thousands of audit rows (5085 on
// 2026-08-17), and a 15-row raw tail of that says nothing. Group cardinality is
// bounded by entity types x actions x users, so it cannot approach the 1000-row
// truncation limit the way the raw log would.
export function activityDigest(
  clientId: number,
  scope: DayScope,
  products: string[],
) {
  return db
    .select({
      entityType: auditLog.entityType,
      action: auditLog.action,
      userId: auditLog.userId,
      n: count(),
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.clientId, clientId),
        gte(auditLog.createdAt, scope.from),
        lte(auditLog.createdAt, scope.to),
        products.length ? productScoped(clientId, products) : undefined,
      ),
    )
    .groupBy(auditLog.entityType, auditLog.action, auditLog.userId);
}

/**
 * Keeps only the audit rows whose entity belongs to one of `products`.
 *
 * `audit_log` carries no product of its own (`entity_type` + `entity_id` and
 * nothing else), so the product has to be resolved per entity type. Six types
 * can be resolved and they cover 97% of the volume; the rest — text_formatting,
 * keywords, uploaded_files, share_galleries, config, monitoring — have no
 * product dimension at all and correctly drop out while a filter is on. So do
 * rows for deleted entities: the row they point at is gone, and digging the
 * product out of the `before` JSON is not worth the parse.
 *
 * Resolved as a row-constructor IN, not an EXISTS: the subquery is
 * uncorrelated, so Postgres hashes it once rather than per audit row.
 *
 * The messages branch resolves its product with the shared `messageProduct`
 * expression — the DCO/Agentic rule is correctness-critical and must not drift
 * between here and the library counts.
 */
export function productScoped(clientId: number, products: string[]) {
  const wanted = sql.join(
    products.map((p) => sql`${p}`),
    sql`, `,
  );
  return sql`(${auditLog.entityType}, ${auditLog.entityId}) in (
    select kind, id from (
      select 'messages' as kind, ${messages.id}::text as id,
             ${messageProduct} as product
        from ${messages}
        left join ${audiences}
          on ${audiences.key} = ${messages.audience}
         and ${audiences.clientId} = ${messages.clientId}
       where ${messages.clientId} = ${clientId}
      union all
      select 'topics', ${topics.id}::text,
             coalesce(${topics.product}, split_part(${topics.key}, '_', 1))
        from ${topics} where ${topics.clientId} = ${clientId}
      union all
      select 'feed_exports', ${feedExports.id}::text, ${feedExports.product}
        from ${feedExports} where ${feedExports.clientId} = ${clientId}
      union all
      select 'creatives', ${creatives.id}::text, ${creatives.product}
        from ${creatives} where ${creatives.clientId} = ${clientId}
      union all
      select 'assets', ${assets.id}::text, ${assets.product}
        from ${assets} where ${assets.clientId} = ${clientId}
      union all
      select 'audiences', ${audiences.id}::text, ${audiences.product}
        from ${audiences} where ${audiences.clientId} = ${clientId}
    ) resolved
    where resolved.product in (${wanted})
  )`;
}

export type ActivityBucket = {
  /** `YYYY-MM-DD`, or `YYYY-MM-DD HH` when the window is a single day. */
  bucket: string;
  n: number;
};

/**
 * The same writes the digest counts, laid out in time.
 *
 * The digest answers "what was written"; this answers "when" — the question a
 * list grouped by kind structurally cannot. Same window, same product scoping
 * (`productScoped`), so the curve and the counts under it are the same number
 * split two ways and can never disagree.
 *
 * Granularity follows the window: a day-wide window bucketed by day is one
 * point, which is not a series, so it buckets by HOUR instead. `created_at` is
 * a `YYYY-MM-DD HH:MM:SS` string (nowUtc), so the bucket is a prefix — no date
 * parsing, and the same lexical ordering the column is already stored in.
 *
 * Gaps are filled by the caller, not here: a day with no writes is a zero in
 * the series, and SQL that returns nothing for it would draw a line straight
 * through the quiet day as if it never happened.
 */
export function activitySeries(
  clientId: number,
  scope: DayScope,
  products: string[],
) {
  // Written as raw, table-qualified SQL on purpose. Handed `${auditLog.createdAt}`,
  // drizzle renders the column WITHOUT its table in the select list and WITH it
  // in the GROUP BY, and Postgres then matches neither against the other:
  // `column "audit_log.created_at" must appear in the GROUP BY clause`. One
  // literal string renders identically in both places. The width is ours (10 or
  // 13), never user input, so `sql.raw` cannot carry anything in.
  const width = scope.range === "day" ? 13 : 10;
  const bucket = sql<string>`substring(audit_log.created_at, 1, ${sql.raw(
    String(width),
  )})`;
  return db
    .select({ bucket, n: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.clientId, clientId),
        gte(auditLog.createdAt, scope.from),
        lte(auditLog.createdAt, scope.to),
        products.length ? productScoped(clientId, products) : undefined,
      ),
    )
    .groupBy(bucket)
    .orderBy(bucket);
}
