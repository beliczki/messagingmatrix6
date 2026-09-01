import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, feedExports, users } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  buildFeedRowSet,
  decideVersion,
  defaultLabelFor,
  deserializePayload,
  diffRowSets,
  pmmidRowKey,
  serializePayload,
} from "@/lib/feed-export";
import {
  feedExportDisplayName,
  feedExportFilename,
} from "@/lib/feed-filename";
import {
  DEFAULT_SIGNAL_COLUMN,
  isValidSignalColumn,
  platformForSignalColumn,
  SIGNAL_COLUMN_OPTIONS,
} from "@/lib/feed-signal";

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
  source: string;
  platform: string;
  // The exact name the download route will produce, so the list can show the
  // file you are about to get instead of making you guess it.
  filename: string;
};

function shapeRow(
  r: typeof feedExports.$inferSelect,
  emailById: Map<string, string>,
  clientKey: string,
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
    platform: r.platform,
    filename: feedExportDisplayName(r, clientKey),
    defaultMessageId: r.defaultMessageId,
    defaultLabel: r.defaultLabel,
    rowCount: r.rowCount,
    notes: r.notes,
    source: r.source,
  };
}

async function resolveEmails(
  rows: Array<{ exportedBy: string | null; uploadedBy: string | null }>,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.exportedBy) ids.add(r.exportedBy);
    if (r.uploadedBy) ids.add(r.uploadedBy);
  }
  if (ids.size === 0) return new Map();
  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(found.map((u) => [u.id, u.email]));
}

export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const product = url.searchParams.get("product");

  const where = product
    ? and(
        eq(feedExports.clientId, claims.cid),
        eq(feedExports.product, product),
      )
    : eq(feedExports.clientId, claims.cid);

  const rows = await db
    .select()
    .from(feedExports)
    .where(where)
    .orderBy(desc(feedExports.exportedAt));

  const emailById = await resolveEmails(rows);
  const [client] = await db
    .select({ key: clients.key })
    .from(clients)
    .where(eq(clients.id, claims.cid))
    .limit(1);
  const clientKey = client?.key ?? `client-${claims.cid}`;
  return NextResponse.json({
    feedExports: rows.map((r) => shapeRow(r, emailById, clientKey)),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | {
        product?: unknown;
        defaultMessageId?: unknown;
        forceNewVersion?: unknown;
        signalColumn?: unknown;
        baselineExportId?: unknown;
        notes?: unknown;
        messageIds?: unknown;
        dryRun?: unknown;
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
  // Which platform's signal header the XLSX should carry. An unknown value is
  // rejected rather than passed through: this string lands in a header AdForm
  // and DV360 both parse strictly, so a typo would produce a file that imports
  // as garbage on the far side.
  if (
    body.signalColumn !== undefined &&
    !isValidSignalColumn(body.signalColumn)
  ) {
    return NextResponse.json(
      {
        error: "bad_signal_column",
        reason: `signalColumn must be one of: ${SIGNAL_COLUMN_OPTIONS.map((o) => o.value).join(", ")}`,
      },
      { status: 400 },
    );
  }
  const signalColumn = isValidSignalColumn(body.signalColumn)
    ? body.signalColumn
    : DEFAULT_SIGNAL_COLUMN;
  // The signal header IS the platform statement: there is one header per
  // platform and one platform per file, so deriving it here keeps the two from
  // ever disagreeing on a row.
  const platform = platformForSignalColumn(signalColumn);
  // Which earlier feed this export builds on. It is both the diff baseline and
  // the carry-forward set, so exporting one section of a product must point at
  // THAT section's previous feed.
  const baselineExportId =
    typeof body.baselineExportId === "number" ? body.baselineExportId : null;
  const notes = typeof body.notes === "string" ? body.notes : null;
  const messageIds = Array.isArray(body.messageIds)
    ? body.messageIds.filter((v): v is number => typeof v === "number")
    : null;
  // Dry-run: build + diff + decide, but skip the insert/audit so the dialog
  // can render the impact preview the moment it opens (before the user
  // commits to a download). Same response shape minus the persisted row.
  const dryRun = body.dryRun === true;

  const built = await buildFeedRowSet({
    clientId: claims.cid,
    product,
    platform,
    baselineExportId,
    defaultMessageId,
    forceNewVersion,
    messageIds,
  });

  // Stamped on the row set (not into `columns`) so the stored payload remembers
  // which platform this export was built for, and the download can rename the
  // header without any of the diffing above ever seeing a different column set.
  built.rowSet.signalColumn = signalColumn;

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

  // Version decision (append vs new_version). Match rows the way the baseline
  // allows: the default key is (advert_id, ReportingLabel), which only works
  // between two MM6 exports. An uploaded reference has AdForm's advert_ids and
  // our freshly built rows have none, so that key matches almost nothing and
  // the decision was made on a diff that reported nearly every row as removed —
  // 190 "removed" against a baseline the PMMID-matched preview put at 46. PMMID
  // is the identity MM6 owns, so it is what a reference is compared on, here as
  // well as in the preview below.
  const lastExportPayload = built.liveExport
    ? deserializePayload(built.liveExport.payloadJson)
    : null;
  const baselineIsReference = built.liveExport?.source === "adform_snapshot";
  const versionDiff = diffRowSets(
    lastExportPayload,
    built.rowSet,
    baselineIsReference ? pmmidRowKey : undefined,
  );
  const decision = decideVersion(
    built.liveExport,
    built.rowSet,
    versionDiff,
    forceNewVersion,
  );

  // The user-facing preview diff uses an AdForm snapshot if one is uploaded
  // (matched by PMMID — MM6 has no advert_id, AdForm has). Otherwise fall
  // back to the MM6-last-export diff we already computed for versioning.
  //
  // Scoped by platform: a product can have one reference per platform, and
  // without this the limit(1) would pick whichever row came back first — an
  // AdForm export diffed against the DV360 reference reads every row of the
  // other platform as a difference.
  const [snapshotRow] = baselineExportId
    ? [built.liveExport]
    : await db
    .select()
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, claims.cid),
        eq(feedExports.source, "adform_snapshot"),
        eq(feedExports.product, product),
        eq(feedExports.platform, platform),
      ),
    )
    // Newest reference wins: several can exist for one product+platform, and
    // the baseline must be the most recent picture of what the platform holds.
    .orderBy(desc(feedExports.uploadedToAdformAt))
    .limit(1);
  const snapshotPayload = snapshotRow
    ? deserializePayload(snapshotRow.payloadJson)
    : null;
  // Name the baseline honestly: an explicitly chosen one may be either an
  // uploaded reference or an earlier export, and saying "AdForm snapshot" for
  // an export would misdescribe what the numbers were measured against.
  const diffSource: "adform_snapshot" | "mm6_last_export" | "none" =
    snapshotPayload
      ? snapshotRow?.source === "adform_snapshot"
        ? "adform_snapshot"
        : "mm6_last_export"
      : built.liveExport
        ? "mm6_last_export"
        : "none";
  const prevPayload = snapshotPayload ?? lastExportPayload;
  const diff = snapshotPayload
    ? diffRowSets(snapshotPayload, built.rowSet, pmmidRowKey)
    : versionDiff;

  const defaultLabel = built.defaultMessage
    ? defaultLabelFor(built.defaultMessage)
    : null;

  const diffPayload = {
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
    source: diffSource,
    snapshot: snapshotRow
      ? {
          filename:
            snapshotRow.notes?.replace(/^Uploaded from AdForm:\s*/, "") ?? "",
          uploadedAt: snapshotRow.uploadedToAdformAt ?? snapshotRow.exportedAt,
          rowCount: snapshotRow.rowCount,
        }
      : null,
  };

  if (dryRun) {
    return NextResponse.json({
      feedExport: null,
      decision,
      diff: diffPayload,
      // Surface the would-be-built row count so the dialog can show a
      // "Rows: N" stat alongside the diff before the user commits.
      previewRowCount: built.rowSet.rows.length,
      // The name this export would download as, so the dialog can put the file
      // in its header instead of just the product.
      filenamePreview: feedExportFilename(
        (
          await db
            .select({ key: clients.key })
            .from(clients)
            .where(eq(clients.id, claims.cid))
            .limit(1)
        )[0]?.key ?? `client-${claims.cid}`,
        product,
        platform,
        decision.feedVersion,
        null,
      ),
    });
  }

  const [inserted] = await db
    .insert(feedExports)
    .values({
      clientId: claims.cid,
      product,
      feedVersion: decision.feedVersion,
      exportedBy: claims.sub,
      defaultMessageId: built.defaultMessage?.id ?? null,
      defaultLabel,
      rowCount: built.rowSet.rows.length,
      platform,
      payloadJson: serializePayload(built.rowSet),
      notes,
    })
    .returning();

  await writeAudit({
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

  const emailById = await resolveEmails([inserted]);
  const [postClient] = await db
    .select({ key: clients.key })
    .from(clients)
    .where(eq(clients.id, claims.cid))
    .limit(1);
  return NextResponse.json({
    feedExport: shapeRow(
      inserted,
      emailById,
      postClient?.key ?? `client-${claims.cid}`,
    ),
    decision,
    diff: diffPayload,
  });
});

