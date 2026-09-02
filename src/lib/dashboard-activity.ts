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
 * expression — the DCO/nonDCO rule is correctness-critical and must not drift
 * between here and the library counts.
 */
function productScoped(clientId: number, products: string[]) {
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
