import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences as audiencesTable,
  config,
  feedExports,
  messages as messagesTable,
  nowUtc,
  users,
} from "@/db/schema";
import { withSession, denyDemo } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  extractAudienceKeysFromRowSet,
  extractDefaultMc,
  parseAdformXlsx,
} from "@/lib/adform-snapshot";
import { serializePayload } from "@/lib/feed-export";
import { parseFeedColumns } from "@/lib/feed-patterns";
import { isSignalColumn, platformForSignalColumn } from "@/lib/feed-signal";
import { filenameFromNotes } from "@/lib/feed-filename";

// Snapshots live in `feed_exports` with source='adform_snapshot'. The XLSX
// notes column carries the original filename ("Uploaded from AdForm: <name>").
// The shape returned here is a tighter projection — sidebar UI only needs a
// few fields. The full feedExports rows still surface in the /feeds table via
// /api/feed-exports.

const SNAPSHOT_SOURCE = "adform_snapshot";

type SnapshotOut = {
  id: number;
  product: string;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedByEmail: string | null;
  filename: string;
  rowCount: number;
};

function shape(
  r: typeof feedExports.$inferSelect,
  emailById: Map<string, string>,
): SnapshotOut {
  return {
    id: r.id,
    product: r.product,
    uploadedAt: r.uploadedToAdformAt ?? r.exportedAt,
    uploadedBy: r.uploadedBy,
    uploadedByEmail: r.uploadedBy ? emailById.get(r.uploadedBy) ?? null : null,
    filename: filenameFromNotes(r.notes),
    rowCount: r.rowCount,
  };
}

async function emailLookup(
  userId: string | null,
): Promise<Map<string, string>> {
  if (!userId) return new Map();
  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return new Map(found.map((u) => [u.id, u.email]));
}

export const GET = withSession(async ({ req, claims }) => {
  const url = new URL(req.url);
  const product = url.searchParams.get("product");
  if (product) {
    const [row] = await db
      .select()
      .from(feedExports)
      .where(
        and(
          eq(feedExports.clientId, claims.cid),
          eq(feedExports.source, SNAPSHOT_SOURCE),
          eq(feedExports.product, product),
        ),
      )
      // Several references can exist for one product now; newest wins, and
      // without the ordering limit(1) would return whichever row came back
      // first.
      .orderBy(desc(feedExports.uploadedToAdformAt))
      .limit(1);
    if (!row) return NextResponse.json({ snapshot: null });
    return NextResponse.json({
      snapshot: shape(row, await emailLookup(row.uploadedBy)),
    });
  }
  const rows = await db
    .select()
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, claims.cid),
        eq(feedExports.source, SNAPSHOT_SOURCE),
      ),
    );
  const ids = rows.map((r) => r.uploadedBy).filter((v): v is string => !!v);
  const found =
    ids.length === 0
      ? []
      : await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, ids));
  const emailById = new Map(found.map((u) => [u.id, u.email]));
  return NextResponse.json({
    snapshots: rows.map((r) => shape(r, emailById)),
  });
});

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
    parsed = parseAdformXlsx(buffer);
  } catch (e) {
    return NextResponse.json(
      { error: "parse_failed", reason: (e as Error).message },
      { status: 422 },
    );
  }

  // The uploaded file's headers must equal Settings → Structure → Feed
  // structure verbatim (same names, same order). Otherwise the diff would be
  // meaningless — we'd be comparing apples to oranges. Drop the upload with a
  // specific reason so the user knows which column to fix.
  const [structureRow] = await db
    .select()
    .from(config)
    .where(
      and(eq(config.clientId, claims.cid), eq(config.key, "feedStructure")),
    )
    .limit(1);
  const expected = parseFeedColumns(
    typeof structureRow?.value === "string"
      ? (() => {
          try {
            const parsedVal = JSON.parse(structureRow.value);
            return typeof parsedVal === "string" ? parsedVal : structureRow.value;
          } catch {
            return structureRow.value;
          }
        })()
      : "",
  );
  if (expected.length === 0) {
    return NextResponse.json(
      {
        error: "structure_not_configured",
        reason:
          "Settings → Structure → Feed structure is empty. Configure it before uploading an AdForm snapshot.",
      },
      { status: 422 },
    );
  }
  const uploaded = parsed.rowSet.columns;
  const mismatch = findColumnMismatch(uploaded, expected);
  if (mismatch) {
    return NextResponse.json(
      {
        error: "structure_mismatch",
        reason: mismatch,
        expectedColumns: expected,
        uploadedColumns: uploaded,
      },
      { status: 422 },
    );
  }

  // Normalise the signal column to the configured name before storing. The
  // upload above accepts either platform's alias, but every later diff looks up
  // row values BY COLUMN NAME against a freshly built export — so a snapshot
  // filed under the DV360 alias would report its signal as changed on every
  // single row. The alias the file used is kept on the row set, not in the
  // column list, so a download of this reference still carries it.
  const expectedSignal = expected.find((c) => isSignalColumn(c));
  const uploadedSignal = uploaded.find((c) => isSignalColumn(c));
  if (expectedSignal && uploadedSignal && uploadedSignal !== expectedSignal) {
    parsed.rowSet.columns = uploaded.map((c) =>
      c === uploadedSignal ? expectedSignal : c,
    );
    for (const row of parsed.rowSet.rows) {
      row[expectedSignal] = row[uploadedSignal] ?? "";
      delete row[uploadedSignal];
    }
    parsed.rowSet.signalColumn = uploadedSignal;
  }
  // Read off the file itself: the signal header names the platform, and a file
  // has exactly one. Needed this early because the upsert below is scoped by it.
  const platform = platformForSignalColumn(uploadedSignal ?? "");

  // Infer the product from PMMID audience keys: every PMMID encodes the
  // audience key (between -a_ and -m_), and each audience belongs to a
  // product in this client's audiences table. A snapshot is per-product so
  // the file must resolve to exactly one product.
  const audKeys = extractAudienceKeysFromRowSet(parsed.rowSet);
  if (audKeys.length === 0) {
    return NextResponse.json(
      {
        error: "no_audience_keys",
        reason:
          "Couldn't find any audience keys in PMMID column — file appears empty or PMMIDs are malformed.",
      },
      { status: 422 },
    );
  }
  const knownAudiences = await db
    .select({ key: audiencesTable.key, product: audiencesTable.product })
    .from(audiencesTable)
    .where(
      and(
        eq(audiencesTable.clientId, claims.cid),
        inArray(audiencesTable.key, audKeys),
      ),
    );
  const inferredProducts = new Set(
    knownAudiences.map((a) => a.product).filter((p): p is string => !!p),
  );
  if (inferredProducts.size === 0) {
    const unknown = audKeys.slice(0, 5).join(", ");
    return NextResponse.json(
      {
        error: "audience_not_found",
        reason: `None of the audience keys in this file (${unknown}${audKeys.length > 5 ? ", …" : ""}) match any audience in this client. Import audiences first.`,
      },
      { status: 422 },
    );
  }
  if (inferredProducts.size > 1) {
    return NextResponse.json(
      {
        error: "multiple_products",
        reason: `Snapshot mixes ${inferredProducts.size} products (${[...inferredProducts].join(", ")}). Each snapshot must be a single product — split the file.`,
      },
      { status: 422 },
    );
  }
  const product = [...inferredProducts][0];

  // References accumulate. There used to be an upsert here that deleted the
  // previous snapshot for the product, which meant uploading the DV360
  // reference destroyed the AdForm one — a product legitimately has a live feed
  // per platform, and it may yet need several per platform. Every upload is now
  // kept; the NEWEST one for a (product, platform) is what the diff builds on,
  // the same rule the exports already follow, and the older ones stay as
  // history instead of being thrown away.

  // Default label: read the (number, variant) of the snapshot's DEFAULT row
  // and look the message up in the matrix. If found, label = "MC<num><var> —
  // <name>" (matching MM6 export convention); if the message isn't in the
  // matrix yet, label = "MC<num><var>" alone — we still surface the MC so the
  // user can see what AdForm has, but the name slot stays blank.
  const defaultMc = extractDefaultMc(parsed.rowSet);
  let defaultLabel: string | null = null;
  let defaultMessageId: number | null = null;
  if (defaultMc) {
    const [defaultMsg] = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.clientId, claims.cid),
          eq(messagesTable.number, defaultMc.number),
          eq(messagesTable.variant, defaultMc.variant),
          ...(defaultMc.versionNo !== undefined
            ? [eq(messagesTable.versionNo, defaultMc.versionNo)]
            : []),
        ),
      )
      .limit(1);
    const base = `MC${defaultMc.number}${defaultMc.variant}`;
    defaultLabel = defaultMsg?.name ? `${base} — ${defaultMsg.name}` : base;
    defaultMessageId = defaultMsg?.id ?? null;
  }

  const [inserted] = await db
    .insert(feedExports)
    .values({
      clientId: claims.cid,
      product,
      // Snapshots aren't part of the MM6 version sequence — they represent the
      // current AdForm state, not a numbered build. feedVersion=0 keeps them
      // out of the version-decision math while satisfying the NOT NULL.
      feedVersion: 0,
      exportedBy: claims.sub,
      // nowUtc, not toISOString(): every other timestamp in the schema is
      // "YYYY-MM-DD HH:MM:SS", and these columns are compared as STRINGS to
      // decide which export is live (findLiveExport, and the Feeds list's Live
      // column). Mixing in an ISO stamp breaks that on a shared date, because
      // "T" sorts above " " — an ISO-stamped reference from the morning would
      // outrank an export published the same afternoon.
      uploadedToAdformAt: nowUtc,
      uploadedBy: claims.sub,
      // Read off the file itself: the signal header names the platform, and a
      // file has exactly one. That is why there is no "is this AdForm or DV360"
      // question at upload time -- asking would only let the answer contradict
      // the file.
      platform,
      defaultMessageId,
      defaultLabel,
      rowCount: parsed.rowSet.rows.length,
      payloadJson: serializePayload(parsed.rowSet),
      notes: `Uploaded from AdForm: ${file.name}`,
      source: SNAPSHOT_SOURCE,
    })
    .returning();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "feed_exports",
    entityId: inserted.id,
    // Always a create now: an upload adds a reference, it never replaces one.
    action: "create",
    after: {
      id: inserted.id,
      product,
      platform,
      filename: file.name,
      rowCount: inserted.rowCount,
      sheetName: parsed.sheetName,
      source: SNAPSHOT_SOURCE,
    },
  });

  return NextResponse.json({
    snapshot: shape(inserted, await emailLookup(inserted.uploadedBy)),
  });
});

function findColumnMismatch(
  uploaded: string[],
  expected: string[],
): string | null {
  if (uploaded.length !== expected.length) {
    return `Column count mismatch: file has ${uploaded.length}, Settings → Structure → Feed structure has ${expected.length}.`;
  }
  for (let i = 0; i < uploaded.length; i += 1) {
    if (uploaded[i] === expected[i]) continue;
    // The signal column is the one header that legitimately differs by serving
    // platform (AdForm's placement-id signal vs DV360's external one) while
    // meaning the same thing and carrying the same lineitem_id value. A
    // reference exported for DV360 must upload against an AdForm-configured
    // structure and vice versa, so signal-vs-signal counts as a match.
    if (isSignalColumn(uploaded[i]) && isSignalColumn(expected[i])) continue;
    return `Column ${i + 1} mismatch: file has "${uploaded[i]}", expected "${expected[i]}".`;
  }
  return null;
}

export const DELETE = withSession(async ({ req, claims }) => {
  const denied = denyDemo(claims);
  if (denied) return denied;

  const url = new URL(req.url);
  const product = url.searchParams.get("product");
  if (!product) {
    return NextResponse.json({ error: "product required" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, claims.cid),
        eq(feedExports.source, SNAPSHOT_SOURCE),
        eq(feedExports.product, product),
      ),
    )
    .limit(1);
  if (!row) return NextResponse.json({ deleted: false });

  await db.delete(feedExports).where(eq(feedExports.id, row.id));
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "feed_exports",
    entityId: row.id,
    action: "delete",
    before: {
      id: row.id,
      product,
      filename: filenameFromNotes(row.notes),
      rowCount: row.rowCount,
      source: SNAPSHOT_SOURCE,
    },
  });
  return NextResponse.json({ deleted: true });
});
