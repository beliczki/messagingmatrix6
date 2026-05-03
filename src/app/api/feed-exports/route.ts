import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { feedExports, users } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  buildFeedRowSet,
  decideVersion,
  defaultLabelFor,
  deserializePayload,
  diffRowSets,
  serializePayload,
} from "@/lib/feed-export";

type ExportRowOut = {
  id: number;
  product: string;
  feedVersion: number;
  exportedAt: string;
  exportedBy: string | null;
  exportedByEmail: string | null;
  uploadedToAdformAt: string | null;
  uploadedBy: string | null;
  uploadedByEmail: string | null;
  defaultMessageId: number | null;
  defaultLabel: string | null;
  rowCount: number;
  notes: string | null;
};

function shapeRow(
  r: typeof feedExports.$inferSelect,
  emailById: Map<string, string>,
): ExportRowOut {
  return {
    id: r.id,
    product: r.product,
    feedVersion: r.feedVersion,
    exportedAt: r.exportedAt,
    exportedBy: r.exportedBy,
    exportedByEmail: r.exportedBy ? emailById.get(r.exportedBy) ?? null : null,
    uploadedToAdformAt: r.uploadedToAdformAt,
    uploadedBy: r.uploadedBy,
    uploadedByEmail: r.uploadedBy ? emailById.get(r.uploadedBy) ?? null : null,
    defaultMessageId: r.defaultMessageId,
    defaultLabel: r.defaultLabel,
    rowCount: r.rowCount,
    notes: r.notes,
  };
}

function resolveEmails(
  rows: Array<{ exportedBy: string | null; uploadedBy: string | null }>,
): Map<string, string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.exportedBy) ids.add(r.exportedBy);
    if (r.uploadedBy) ids.add(r.uploadedBy);
  }
  if (ids.size === 0) return new Map();
  const found = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, [...ids]))
    .all();
  return new Map(found.map((u) => [u.id, u.email]));
}

export const GET = withSession(({ req, claims }) => {
  const url = new URL(req.url);
  const product = url.searchParams.get("product");

  const where = product
    ? and(
        eq(feedExports.clientId, claims.cid),
        eq(feedExports.product, product),
      )
    : eq(feedExports.clientId, claims.cid);

  const rows = db
    .select()
    .from(feedExports)
    .where(where)
    .orderBy(desc(feedExports.exportedAt))
    .all();

  const emailById = resolveEmails(rows);
  return NextResponse.json({
    feedExports: rows.map((r) => shapeRow(r, emailById)),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | {
        product?: unknown;
        defaultMessageId?: unknown;
        forceNewVersion?: unknown;
        notes?: unknown;
        messageIds?: unknown;
      }
    | null;
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }
  const product = typeof body.product === "string" ? body.product.trim() : "";
  if (!product) {
    return NextResponse.json({ error: "product required" }, { status: 400 });
  }
  const defaultMessageId =
    typeof body.defaultMessageId === "number" ? body.defaultMessageId : null;
  const forceNewVersion = body.forceNewVersion === true;
  const notes = typeof body.notes === "string" ? body.notes : null;
  const messageIds = Array.isArray(body.messageIds)
    ? body.messageIds.filter((v): v is number => typeof v === "number")
    : null;

  const built = buildFeedRowSet({
    clientId: claims.cid,
    product,
    defaultMessageId,
    forceNewVersion,
    messageIds,
  });

  if (built.rowSet.columns.length === 0) {
    return NextResponse.json(
      { error: "no_feed_columns", reason: "Feed Structure is empty" },
      { status: 422 },
    );
  }
  if (defaultMessageId != null && !built.defaultMessage) {
    return NextResponse.json(
      { error: "default_not_found", reason: "default message not found" },
      { status: 422 },
    );
  }

  const prevPayload = built.liveExport
    ? deserializePayload(built.liveExport.payloadJson)
    : null;
  const diff = diffRowSets(prevPayload, built.rowSet);
  const decision = decideVersion(
    built.liveExport,
    built.rowSet,
    diff,
    forceNewVersion,
  );

  const defaultLabel = built.defaultMessage
    ? defaultLabelFor(built.defaultMessage)
    : null;

  const inserted = db
    .insert(feedExports)
    .values({
      clientId: claims.cid,
      product,
      feedVersion: decision.feedVersion,
      exportedBy: claims.sub,
      defaultMessageId: built.defaultMessage?.id ?? null,
      defaultLabel,
      rowCount: built.rowSet.rows.length,
      payloadJson: serializePayload(built.rowSet),
      notes,
    })
    .returning()
    .get();

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "feed_exports",
    entityId: inserted.id,
    action: "create",
    after: {
      id: inserted.id,
      product,
      feedVersion: inserted.feedVersion,
      rowCount: inserted.rowCount,
      defaultLabel,
      action: decision.action,
      reasons: decision.reasons,
    },
  });

  const emailById = resolveEmails([inserted]);
  return NextResponse.json({
    feedExport: shapeRow(inserted, emailById),
    decision,
    diff: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      unchangedCount: diff.unchangedCount,
      // Lightweight per-bucket previews so the modal doesn't need a second
      // round-trip. Cap at 50 each.
      addedPreview: diff.added.slice(0, 50).map((i) => built.rowSet.rows[i]),
      removedPreview: prevPayload
        ? diff.removed.slice(0, 50).map((i) => prevPayload.rows[i])
        : [],
      changedPreview: diff.changed.slice(0, 50).map((c) => ({
        fields: c.fields,
        prev: prevPayload?.rows[c.prevIndex] ?? null,
        next: built.rowSet.rows[c.nextIndex] ?? null,
      })),
    },
  });
});

