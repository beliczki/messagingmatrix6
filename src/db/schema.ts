import {
  pgTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Reproduce SQLite's CURRENT_TIMESTAMP text format exactly:
// "YYYY-MM-DD HH:MM:SS" in UTC, second precision, no timezone offset.
// Timestamp columns are TEXT (not native timestamptz) — keeping the same
// emitted string preserves string-sort ordering and `new Date(...)` parsing
// across the SQLite→Postgres move. Do NOT switch these to timestamptz.
export const nowUtc = sql`(to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD HH24:MI:SS'))`;

// Multi-tenancy root. Spec §17.2.
// Each running deploy is locked to one client via ACTIVE_CLIENT_KEY env var.
export const clients = pgTable(
  "clients",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
  },
  (t) => [index("clients_status_idx").on(t.status)],
);

// Cross-tenant settings. Spec §17.4.
export const systemConfig = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: text("updated_at")
    .notNull()
    .default(nowUtc),
});

// Per-client users. Spec §17.5.
// Same email allowed across clients as separate rows with independent passwords.
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    password: text("password").notNull(),
    role: text("role").notNull().default("user"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("users_client_email_unique").on(t.clientId, t.email),
    index("users_client_idx").on(t.clientId),
  ],
);

// Per-user MCP bearer tokens, many per client. Scope 'read' registers only
// the read/meta tools; 'full' registers everything. Revocation = archivedAt.
export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    scope: text("scope").notNull().default("full"),
    label: text("label"),
    lastUsedAt: text("last_used_at"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("mcp_tokens_token_unique").on(t.token),
    index("mcp_tokens_client_idx").on(t.clientId),
    index("mcp_tokens_client_user_idx").on(t.clientId, t.userId),
  ],
);

// Server-side action history. Spec §3.13 + §17.3.
export const auditLog = pgTable(
  "audit_log",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
  },
  (t) => [
    index("audit_client_user_idx").on(t.clientId, t.userId),
    index("audit_client_entity_idx").on(t.clientId, t.entityType, t.entityId),
    index("audit_client_created_idx").on(t.clientId, t.createdAt),
  ],
);

// Per-client config (Spec §17.4). Composite PK (client_id, key).
// Categories: patterns, lookAndFeel, structure, storage, adform.
export const config = pgTable(
  "config",
  {
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    category: text("category"),
    description: text("description"),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
  },
  (t) => [
    primaryKey({ columns: [t.clientId, t.key] }),
    index("config_client_category_idx").on(t.clientId, t.category),
  ],
);

// ── Matrix entities ──
// All tenant-scoped tables carry client_id (Spec §17.3) + version for optimistic
// locking (§3 preamble). Every index from §3 is composite-prefixed with client_id.

// §3.1
export const audiences = pgTable(
  "audiences",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull(),
    status: text("status"),
    product: text("product"),
    strategy: text("strategy"),
    buyingPlatform: text("buying_platform"),
    dataSource: text("data_source"),
    targetingType: text("targeting_type"),
    device: text("device"),
    tag: text("tag"),
    comment: text("comment"),
    campaignName: text("campaign_name"),
    campaignId: text("campaign_id"),
    lineitemName: text("lineitem_name"),
    lineitemId: text("lineitem_id"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("audiences_client_key_unique").on(t.clientId, t.key),
    index("audiences_client_product_idx").on(t.clientId, t.product),
    index("audiences_client_order_idx").on(t.clientId, t.orderIndex),
  ],
);

// §3.2 — narrower than audiences: no targeting/trafficking columns
export const topics = pgTable(
  "topics",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull(),
    status: text("status"),
    product: text("product"),
    tag: text("tag"),
    tag1: text("tag1"),
    tag2: text("tag2"),
    tag3: text("tag3"),
    tag4: text("tag4"),
    comment: text("comment"),
    created: text("created"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("topics_client_key_unique").on(t.clientId, t.key),
    index("topics_client_product_idx").on(t.clientId, t.product),
    index("topics_client_order_idx").on(t.clientId, t.orderIndex),
  ],
);

// §3.3
export const messages = pgTable(
  "messages",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    variant: text("variant").notNull(),
    audience: text("audience").notNull(),
    topic: text("topic").notNull(),
    versionNo: integer("version_no").notNull().default(1),
    pmmid: text("pmmid"),
    status: text("status"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    template: text("template"),
    templateVariantClasses: text("template_variant_classes"),
    name: text("name"),
    headline: text("headline"),
    copy1: text("copy1"),
    copy2: text("copy2"),
    disclaimer: text("disclaimer"),
    // Per-text-element inline CSS (or class names) — verified used in real
    // Erste data (e.g. headline_style="font-size:1.1rem;"). Spec §6.3 Styles
    // tab. v5 calls these *_style columns.
    headlineStyle: text("headline_style"),
    copy1Style: text("copy1_style"),
    copy2Style: text("copy2_style"),
    disclaimerStyle: text("disclaimer_style"),
    ctaStyle: text("cta_style"),
    // Free-form per-message CSS (CodeMirror in the editor). v5 column "CSS".
    customCss: text("custom_css"),
    image1: text("image1"),
    image2: text("image2"),
    image3: text("image3"),
    image4: text("image4"),
    image5: text("image5"),
    image6: text("image6"),
    video1: text("video1"),
    flash: text("flash"),
    flashStyle: text("flash_style"),
    cta: text("cta"),
    landingUrl: text("landing_url"),
    comment: text("comment"),
    utmCampaign: text("utm_campaign"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    utmCd26: text("utm_cd26"),
    finalTraffickedUrl: text("final_trafficked_url"),
    brief: text("brief"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("messages_client_topic_audience_idx").on(
      t.clientId,
      t.topic,
      t.audience,
    ),
    index("messages_client_status_idx").on(t.clientId, t.status),
    index("messages_client_number_idx").on(t.clientId, t.number),
    index("messages_client_pmmid_idx").on(t.clientId, t.pmmid),
  ],
);

// Auto-generated preview screenshots for dynamic-HTML MCs — one PNG per template
// size. Regenerable derivative (bytes in the object store under previews/), so this
// is cache, not source of truth: a row is STALE when message_version != the parent
// message's `version` (the optimistic-lock int the matrix iframe render-cache also
// keys on, so any edit invalidates). Populated out-of-band by scripts/gen-previews.ts.
export const messagePreviews = pgTable(
  "message_previews",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    // "WIDTHxHEIGHT", matches templates.ts sizes (e.g. "300x250").
    size: text("size").notNull(),
    // Relative object-store path / S3 key returned by storage.writeFile.
    storageKey: text("storage_key").notNull(),
    // Snapshot of messages.version at capture time → staleness check.
    messageVersion: integer("message_version").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
  },
  (t) => [
    uniqueIndex("message_previews_message_size_unique").on(
      t.clientId,
      t.messageId,
      t.size,
    ),
    index("message_previews_client_message_idx").on(t.clientId, t.messageId),
  ],
);

// §3.4
export const assets = pgTable(
  "assets",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brand: text("brand"),
    product: text("product"),
    type: text("type"),
    visualKeyword: text("visual_keyword"),
    fileId: text("file_id"),
    fileName: text("file_name"),
    fileFormat: text("file_format"),
    fileSize: text("file_size"),
    fileDimensions: text("file_dimensions"),
    comment: text("comment"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("assets_client_brand_idx").on(t.clientId, t.brand),
    index("assets_client_product_idx").on(t.clientId, t.product),
    index("assets_client_type_idx").on(t.clientId, t.type),
    index("assets_client_file_idx").on(t.clientId, t.fileId),
  ],
);

// §3.5
export const creatives = pgTable(
  "creatives",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brand: text("brand"),
    product: text("product"),
    type: text("type"),
    visualKeyword: text("visual_keyword"),
    copyKeyword: text("copy_keyword"),
    template: text("template"),
    bannerVersion: text("banner_version"),
    mcNumber: integer("mc_number"),
    mcVariant: text("mc_variant"),
    fileId: text("file_id"),
    fileName: text("file_name"),
    fileFormat: text("file_format"),
    fileSize: text("file_size"),
    fileDimensions: text("file_dimensions"),
    familyKey: text("family_key"),
    comment: text("comment"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("creatives_client_brand_idx").on(t.clientId, t.brand),
    index("creatives_client_product_idx").on(t.clientId, t.product),
    index("creatives_client_file_idx").on(t.clientId, t.fileId),
    index("creatives_client_mc_idx").on(t.clientId, t.mcNumber, t.mcVariant),
    index("creatives_client_family_idx").on(t.clientId, t.familyKey),
  ],
);

// §3.6
export const textFormatting = pgTable(
  "text_formatting",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    textOriginal: text("text_original").notNull(),
    textFormatted: text("text_formatted").notNull(),
    formattingScope: text("formatting_scope"),
    formattingMcScope: text("formatting_mc_scope"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [index("text_formatting_client_idx").on(t.clientId)],
);

// §3.7
export const reporting = pgTable(
  "reporting",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    mcLabel: text("mc_label"),
    size: text("size"),
    bannerId: text("banner_id"),
    bannerName: text("banner_name"),
    adformStatus: text("adform_status"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    ctr: real("ctr"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    syncedAt: text("synced_at"),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("reporting_client_mc_idx").on(t.clientId, t.mcLabel),
    index("reporting_client_mc_size_idx").on(t.clientId, t.mcLabel, t.size),
    index("reporting_client_level_idx").on(t.clientId, t.level),
  ],
);

// §3.7b — monitoring: message-level performance ingested from a standalone
// AdForm "Creative custom report" XLSX (and later other platforms). One row
// per (platform, message-key) per report period — the raw export is keyword/
// banner-level (~85k rows/mo) but the matrix only needs message-level numbers,
// so the importer aggregates. `platform`/`scope` are derived from the PMMID
// scope prefix (p_adform / p_dv360 / p_meta_… / …). Distinct from `reporting`
// above (the legacy workbook-sourced banner snapshot, slated for removal).
export const monitoring = pgTable(
  "monitoring",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // normalized platform (adform, dv360, googleads, meta, tiktok, …)
    platform: text("platform").notNull(),
    // raw PMMID scope prefix, e.g. "p_infinety_avpackage" — kept for fidelity
    scope: text("scope"),
    // representative full PMMID for this message-key (nullable)
    pmmid: text("pmmid"),
    // resolved link to the matrix message; null until/unless matched
    messageId: integer("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    // how the message link was resolved: "exact" (full 4-part key),
    // "family" (number+variant resolved to exactly one message),
    // "family_known" (number+variant exists but fans out to several cells —
    // messageId stays null), or null (no match at all).
    matchLevel: text("match_level"),
    // resolved product code. Matched rows: from the matrix (audience→product);
    // unmatched: from the keyword→product rules in Settings → Structure →
    // Monitoring (matched against topic + pmmid). Null when neither resolves.
    product: text("product"),
    // creative size (e.g. "300x250", "1x1"), parsed from the Banner/Adgroups
    // cell. Part of the aggregation key so the detail dialog can break an MC
    // down per size. "" when no size token was found.
    size: text("size").notNull().default(""),
    // parsed message key (always present — rows without -m_ are skipped)
    audienceKey: text("audience_key").notNull(),
    topicKey: text("topic_key").notNull(),
    mcNumber: integer("mc_number").notNull(),
    mcVariant: text("mc_variant").notNull(),
    // aggregated metrics
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    cost: real("cost").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    ctr: real("ctr"),
    // report period (from the XLSX Front Page)
    periodFrom: text("period_from").notNull(),
    periodTo: text("period_to").notNull(),
    importedAt: text("imported_at")
      .notNull()
      .default(nowUtc),
    sourceFilename: text("source_filename"),
  },
  (t) => [
    index("monitoring_client_message_idx").on(t.clientId, t.messageId),
    index("monitoring_client_platform_idx").on(t.clientId, t.platform),
    index("monitoring_client_mc_idx").on(t.clientId, t.mcNumber, t.mcVariant),
    // one row per (platform, message-key, size) per period — re-upload replaces
    uniqueIndex("monitoring_client_period_key_idx").on(
      t.clientId,
      t.platform,
      t.periodFrom,
      t.periodTo,
      t.mcNumber,
      t.mcVariant,
      t.audienceKey,
      t.topicKey,
      t.size,
    ),
  ],
);

// §3.10 — public share-gallery metadata
export const shareGalleries = pgTable(
  "share_galleries",
  {
    id: text("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title"),
    description: text("description"),
    createdBy: text("created_by"),
    metadata: text("metadata"),
    viewCount: integer("view_count").notNull().default(0),
    downloadCount: integer("download_count").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [index("share_galleries_client_idx").on(t.clientId)],
);

// Per-item comments on a public share gallery. itemKey is "matrix:{messageId}:{size}"
// for matrix items and "creative:{id}" for uploaded creatives. annotation is
// optional JSON: {type:"point", x, y} or {type:"rect", x, y, w, h} where all
// coords are normalized 0-1 (relative to the item's preview surface).
export const shareComments = pgTable(
  "share_comments",
  {
    id: text("id").primaryKey(),
    shareGalleryId: text("share_gallery_id")
      .notNull()
      .references(() => shareGalleries.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    annotation: text("annotation"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    index("share_comments_share_idx").on(t.shareGalleryId),
    index("share_comments_share_item_idx").on(t.shareGalleryId, t.itemKey),
  ],
);

// §3.11 — unified file registry
export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: text("id").primaryKey(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    dimensions: text("dimensions"),
    sha256: text("sha256"),
    uploadedBy: text("uploaded_by"),
    category: text("category").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    // Intra-client dedup *lookup* (Spec §17.10) — many logical rows may point
    // at the same storage_path; the sha lookup finds an existing row whose
    // storage_path we can reuse, then we INSERT a new row.
    index("uploaded_files_client_sha_idx").on(t.clientId, t.sha256),
    index("uploaded_files_client_category_idx").on(t.clientId, t.category),
    index("uploaded_files_client_cat_created_idx").on(
      t.clientId,
      t.category,
      t.createdAt,
    ),
  ],
);

// §17.13 (Phase 10b) — point-in-time snapshots of the 10 tenant-scoped tables
// for one-shot restore. payload is a JSON object whose keys are the table
// names and values are arrays of full row objects. Restore wipes-then-inserts
// in a transaction. Does NOT include config / clients / system_config /
// audit_log (history must survive restore).
export const snapshots = pgTable(
  "snapshots",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    createdBy: text("created_by"),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
  },
  (t) => [index("snapshots_client_created_idx").on(t.clientId, t.createdAt)],
);

export type Snapshot = typeof snapshots.$inferSelect;

// AdForm-aware feed export history. One row per "Preview & Export" action
// from the Matrix Feed view (one product, ACTIVE-status filter). The user
// may export multiple drafts before manually marking one as "uploaded to
// AdForm" (uploaded_to_adform_at). Subsequent exports for the same
// (client, product, feed_version) diff against the latest *uploaded* row
// and may force a new feed_version when the diff would require deleting a
// live row (sticky-superset rule) or when row_count > 500.
//
// payload_json shape:
//   {
//     columns: string[],            // verbatim feedStructure split
//     rows:    Array<Record<string,string>>,  // each cell pre-evaluated
//     messageIds: number[],         // one per row (DEFAULT row → -1 sentinel)
//     defaultRowIndex: number       // index of the DEFAULT row in `rows`
//   }
export const feedExports = pgTable(
  "feed_exports",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    product: text("product").notNull(),
    feedVersion: integer("feed_version").notNull(),
    exportedAt: text("exported_at")
      .notNull()
      .default(nowUtc),
    exportedBy: text("exported_by"),
    uploadedToAdformAt: text("uploaded_to_adform_at"),
    uploadedBy: text("uploaded_by"),
    defaultMessageId: integer("default_message_id"),
    defaultLabel: text("default_label"),
    rowCount: integer("row_count").notNull(),
    payloadJson: text("payload_json").notNull(),
    notes: text("notes"),
    // Discriminator. Default rows ("export") are produced by MM6's Preview &
    // Export flow. "adform_snapshot" rows are user-uploaded XLSX files
    // captured directly from AdForm — the actual current live state. They
    // share the same payload shape so they can be diffed and downloaded
    // through the same code paths.
    source: text("source").notNull().default("export"),
  },
  (t) => [
    index("feed_exports_client_product_idx").on(t.clientId, t.product),
    index("feed_exports_client_uploaded_idx").on(t.clientId, t.uploadedToAdformAt),
    index("feed_exports_client_product_version_idx").on(
      t.clientId,
      t.product,
      t.feedVersion,
    ),
    index("feed_exports_client_source_idx").on(t.clientId, t.source),
  ],
);

export type FeedExport = typeof feedExports.$inferSelect;
export type NewFeedExport = typeof feedExports.$inferInsert;

// Settings → Keywords tab. Per-client allowed-values lists for dimension-grid
// dropdowns (audience/topic editors). v1 scope: 7 audience fields + 5 topic
// fields (see tasks/todo.md "Settings → Keywords tab" checkpoint).
// `form` = entity name ("audiences" | "topics"); `field` = camelCase v6 column
// name (e.g. "buyingPlatform", not the XLSX "Buying_platform"). `value` is the
// allowed string. Editor dropdowns autocomplete from this list but accept
// freeform input — empty list ⇒ pure freeform.
export const keywords = pgTable(
  "keywords",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    form: text("form").notNull(),
    field: text("field").notNull(),
    value: text("value").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("keywords_client_form_field_value_unique").on(
      t.clientId,
      t.form,
      t.field,
      t.value,
    ),
    index("keywords_client_form_field_order_idx").on(
      t.clientId,
      t.form,
      t.field,
      t.orderIndex,
    ),
  ],
);

export type Keyword = typeof keywords.$inferSelect;
export type NewKeyword = typeof keywords.$inferInsert;

export type ConfigRow = typeof config.$inferSelect;
export type NewConfigRow = typeof config.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type McpToken = typeof mcpTokens.$inferSelect;
export type NewMcpToken = typeof mcpTokens.$inferInsert;
export type Audience = typeof audiences.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Creative = typeof creatives.$inferSelect;
export type TextFormatting = typeof textFormatting.$inferSelect;
export type Reporting = typeof reporting.$inferSelect;
export type ShareGallery = typeof shareGalleries.$inferSelect;
export type ShareComment = typeof shareComments.$inferSelect;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
