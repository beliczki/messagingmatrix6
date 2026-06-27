import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences as audiencesTable, config } from "@/db/schema";
import { type ProductRule } from "@/lib/adform-report";

// Shared inputs for product resolution on monitoring rows: the matrix
// audience→product map and the keyword→product rules saved in Settings →
// Structure → Monitoring (config `monitoringProductRules`). Used by both the
// import route and the "re-apply" route so the two never drift.
export async function loadProductContext(clientId: number): Promise<{
  audienceProduct: Map<string, string | null>;
  rules: ProductRule[];
}> {
  const audienceProduct = new Map<string, string | null>(
    (
      await db
        .select({ key: audiencesTable.key, product: audiencesTable.product })
        .from(audiencesTable)
        .where(eq(audiencesTable.clientId, clientId))
    ).map((a) => [a.key, a.product]),
  );

  const [rulesRow] = await db
    .select({ value: config.value })
    .from(config)
    .where(
      and(eq(config.clientId, clientId), eq(config.key, "monitoringProductRules")),
    )
    .limit(1);

  let rules: ProductRule[] = [];
  if (rulesRow?.value) {
    try {
      const parsed = JSON.parse(rulesRow.value);
      if (Array.isArray(parsed)) {
        rules = parsed.filter(
          (r): r is ProductRule =>
            r && typeof r.keyword === "string" && typeof r.product === "string",
        );
      }
    } catch {
      // malformed → none; the Structure tab validates on save
    }
  }

  return { audienceProduct, rules };
}
