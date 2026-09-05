import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { monitoring, messages as messagesTable } from "@/db/schema";
import { withSession, denyDemo } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  buildMessageResolver,
  parseAdformReport,
  resolveProduct,
} from "@/lib/adform-report";
import { loadProductContext } from "@/lib/monitoring-products";

// POST /api/monitoring/import — multipart upload of a standalone AdForm
// "Creative custom report" XLSX. Parses + aggregates to message level, resolves
// each row to a matrix message by (number, variant, audience, topic), then
// replaces the slice for this report period (one file = one period snapshot).

// Rows per INSERT statement. Postgres' bind message caps a statement at 65534
// parameters and a monitoring row spends 21 of them, so a single-statement
// insert dies with MAX_PARAMETERS_EXCEEDED above 3120 rows — which a full month
// of AdForm data clears several times over now that rows are day-grained
// (May 2026: 3,002 rows folded whole, 67,749 per day). Chunked inside the same
// transaction, so the period slice is still replaced atomically.
const INSERT_CHUNK = 1000;

export const POST = withSession(async ({ req, claims }) => {
  const denied = denyDemo(claims);
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "multipart/form-data required" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseAdformReport(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: "parse_failed", reason: (e as Error).message },
      { status: 422 },
    );
  }

  // Resolve each aggregated row to a matrix message via the tiered resolver
  // (exact 4-part key → unique number+variant family → family_known).
  const msgRows = await db
    .select({
      id: messagesTable.id,
      number: messagesTable.number,
      variant: messagesTable.variant,
      audience: messagesTable.audience,
      topic: messagesTable.topic,
    })
    .from(messagesTable)
    // Monitoring must NEVER resolve onto a draft: a draft has not run anywhere,
    // so a reported row that appears to match one is a mis-match by definition.
    // Drafts also carry a number and variant, which is exactly what the
    // family-level fallback keys on — so without this they would be candidates.
    .where(
      and(
        eq(messagesTable.clientId, claims.cid),
        isNotNull(messagesTable.audience),
      ),
    );
  const resolve = buildMessageResolver(
    msgRows.filter(
      (r): r is typeof r & { audience: string; topic: string } =>
        r.audience !== null && r.topic !== null,
    ),
  );

  // Product resolution inputs: audience→product (matrix-authoritative) + the
  // keyword→product rules from Settings → Structure → Monitoring.
  const { audienceProduct, rules: productRules } =
    await loadProductContext(claims.cid);

  const values = parsed.rows.map((r) => {
    const match = resolve(r.mcNumber, r.mcVariant, r.audienceKey, r.topicKey);
    return {
      clientId: claims.cid,
      platform: r.platform,
      scope: r.scope,
      pmmid: r.pmmid,
      messageId: match.messageId,
      matchLevel: match.matchLevel,
      product: resolveProduct(
        r.audienceKey,
        r.topicKey,
        r.pmmid,
        audienceProduct,
        productRules,
      ),
      size: r.size,
      day: r.day,
      audienceKey: r.audienceKey,
      topicKey: r.topicKey,
      mcNumber: r.mcNumber,
      mcVariant: r.mcVariant,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      cost: r.cost,
      conversions: Math.round(r.conversions),
      ctr: r.ctr,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      sourceFilename: file.name,
    };
  });

  // One report file = the full snapshot for its period. Re-uploading the same
  // period replaces every row for it (all platforms), so totals never double.
  await db.transaction(async (tx) => {
    await tx
      .delete(monitoring)
      .where(
        and(
          eq(monitoring.clientId, claims.cid),
          eq(monitoring.periodFrom, parsed.periodFrom),
          eq(monitoring.periodTo, parsed.periodTo),
        ),
      );
    for (let i = 0; i < values.length; i += INSERT_CHUNK) {
      await tx.insert(monitoring).values(values.slice(i, i + INSERT_CHUNK));
    }
  });

  const matched = values.filter((v) => v.messageId !== null).length;
  const familyKnown = values.filter(
    (v) => v.matchLevel === "family_known",
  ).length;
  const platforms = [...new Set(values.map((v) => v.platform))].sort();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "monitoring",
    entityId: 0,
    action: "bulk_create",
    after: {
      filename: file.name,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      imported: values.length,
      matched,
      familyKnown,
      unmatched: values.length - matched,
      skipped: parsed.skipped,
      totalDataRows: parsed.totalDataRows,
      platforms,
    },
  });

  return NextResponse.json({
    imported: values.length,
    matched,
    familyKnown,
    unmatched: values.length - matched,
    skipped: parsed.skipped,
    totalDataRows: parsed.totalDataRows,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    platforms,
  });
});
