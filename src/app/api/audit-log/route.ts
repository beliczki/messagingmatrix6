import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { productScoped } from "@/lib/dashboard-activity";
import { withAdmin } from "@/lib/scoped";

const VALID_ACTIONS = new Set([
  "create",
  "update",
  "delete",
  "archive",
  "restore",
  "snapshot_restore",
  "bulk_move",
  "bulk_copy",
  "bulk_create",
  "bulk_update",
  "bulk_delete",
  "bulk_archive",
  "bulk_restore",
]);

export const GET = withAdmin(async ({ req, claims }) => {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const actionsRaw = url.searchParams.get("actions");
  const userId = url.searchParams.get("userId");
  const since = url.searchParams.get("since"); // ISO date
  const until = url.searchParams.get("until");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? "200"), 1),
    1000,
  );
  const offset = Math.max(
    Number(url.searchParams.get("offset") ?? "0"),
    0,
  );

  const conds = [eq(auditLog.clientId, claims.cid)];
  if (entity) conds.push(eq(auditLog.entityType, entity));
  if (actionsRaw) {
    const actions = actionsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => VALID_ACTIONS.has(s));
    if (actions.length > 0) conds.push(inArray(auditLog.action, actions));
  }
  if (userId) conds.push(eq(auditLog.userId, userId));
  if (since) conds.push(gte(auditLog.createdAt, since));
  if (until) conds.push(lte(auditLog.createdAt, until));
  // Same product scoping the dashboard digest counts with, so the drill-down
  // lists exactly the rows the number on the panel was built from — a second,
  // looser rule here would show a count of 28 opening onto 31 rows.
  const products = (url.searchParams.get("products") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (products.length > 0) conds.push(productScoped(claims.cid, products));

  const rows = await db
    .select()
    .from(auditLog)
    .where(and(...conds))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1) // +1 to detect "has more"
    .offset(offset);

  const hasMore = rows.length > limit;
  return NextResponse.json({
    rows: rows.slice(0, limit),
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  });
});
