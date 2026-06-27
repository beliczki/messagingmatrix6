import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { monitoring } from "@/db/schema";
import { withSession, denyDemo } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { resolveProduct } from "@/lib/adform-report";
import { loadProductContext } from "@/lib/monitoring-products";

// POST /api/monitoring/reapply-products — recompute the `product` column on all
// already-imported monitoring rows using the current saved keyword→product
// rules + audience map. Lets the user iterate on the rules (Settings →
// Structure → Monitoring) without re-uploading the report.

export const POST = withSession(async ({ claims }) => {
  const denied = denyDemo(claims);
  if (denied) return denied;

  const { audienceProduct, rules } = await loadProductContext(claims.cid);

  const rows = await db
    .select({
      id: monitoring.id,
      audienceKey: monitoring.audienceKey,
      topicKey: monitoring.topicKey,
      pmmid: monitoring.pmmid,
      product: monitoring.product,
    })
    .from(monitoring)
    .where(eq(monitoring.clientId, claims.cid));

  let updated = 0;
  let withProduct = 0;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const next = resolveProduct(
        r.audienceKey,
        r.topicKey,
        r.pmmid,
        audienceProduct,
        rules,
      );
      if (next) withProduct += 1;
      if (next !== r.product) {
        await tx
          .update(monitoring)
          .set({ product: next })
          .where(eq(monitoring.id, r.id));
        updated += 1;
      }
    }
  });

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "monitoring",
    entityId: 0,
    action: "bulk_update",
    after: { reapplyProducts: true, rows: rows.length, updated, withProduct },
  });

  return NextResponse.json({ total: rows.length, updated, withProduct });
});
