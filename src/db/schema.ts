import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Multi-tenancy root. Spec §17.2.
// Each running deploy is locked to one client via ACTIVE_CLIENT_KEY env var.
export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    mcpToken: text("mcp_token"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("clients_status_idx").on(t.status)],
);

// Cross-tenant settings. Spec §17.4.
export const systemConfig = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
});

// Per-client users. Spec §17.5.
// Same email allowed across clients as separate rows with independent passwords.
export const users = sqliteTable(
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
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("users_client_email_unique").on(t.clientId, t.email),
    index("users_client_idx").on(t.clientId),
  ],
);

// Server-side action history. Spec §3.13 + §17.3.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("audit_client_user_idx").on(t.clientId, t.userId),
    index("audit_client_entity_idx").on(t.clientId, t.entityType, t.entityId),
    index("audit_client_created_idx").on(t.clientId, t.createdAt),
  ],
);

// Per-client config (Spec §17.4). Composite PK (client_id, key).
// Categories: patterns, lookAndFeel, structure, storage, adform.
export const config = sqliteTable(
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
      .default(sql`(CURRENT_TIMESTAMP)`),
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
export const audiences = sqliteTable(
  "audiences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("audiences_client_key_unique").on(t.clientId, t.key),
    index("audiences_client_product_idx").on(t.clientId, t.product),
    index("audiences_client_order_idx").on(t.clientId, t.orderIndex),
  ],
);

// §3.2 — same headers as audiences plus tag1-4 + created
export const topics = sqliteTable(
  "topics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
    tag1: text("tag1"),
    tag2: text("tag2"),
    tag3: text("tag3"),
    tag4: text("tag4"),
    comment: text("comment"),
    campaignName: text("campaign_name"),
    campaignId: text("campaign_id"),
    lineitemName: text("lineitem_name"),
    lineitemId: text("lineitem_id"),
    created: text("created"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("topics_client_key_unique").on(t.clientId, t.key),
    index("topics_client_product_idx").on(t.clientId, t.product),
    index("topics_client_order_idx").on(t.clientId, t.orderIndex),
  ],
);

// §3.3
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
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

// §3.4
export const assets = sqliteTable(
  "assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("assets_client_brand_idx").on(t.clientId, t.brand),
    index("assets_client_product_idx").on(t.clientId, t.product),
    index("assets_client_type_idx").on(t.clientId, t.type),
    index("assets_client_file_idx").on(t.clientId, t.fileId),
  ],
);

// §3.5
export const creatives = sqliteTable(
  "creatives",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
    comment: text("comment"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    index("creatives_client_brand_idx").on(t.clientId, t.brand),
    index("creatives_client_product_idx").on(t.clientId, t.product),
    index("creatives_client_file_idx").on(t.clientId, t.fileId),
    index("creatives_client_mc_idx").on(t.clientId, t.mcNumber, t.mcVariant),
  ],
);

// §3.6
export const textFormatting = sqliteTable(
  "text_formatting",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("text_formatting_client_idx").on(t.clientId)],
);

// §3.7
export const reporting = sqliteTable(
  "reporting",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
  },
  (t) => [
    index("reporting_client_mc_idx").on(t.clientId, t.mcLabel),
    index("reporting_client_mc_size_idx").on(t.clientId, t.mcLabel, t.size),
    index("reporting_client_level_idx").on(t.clientId, t.level),
  ],
);

// §3.10 — public share-gallery metadata
export const shareGalleries = sqliteTable(
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [index("share_galleries_client_idx").on(t.clientId)],
);

// §3.11 — unified file registry
export const uploadedFiles = sqliteTable(
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
      .default(sql`(CURRENT_TIMESTAMP)`),
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

export type ConfigRow = typeof config.$inferSelect;
export type NewConfigRow = typeof config.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Audience = typeof audiences.$inferSelect;
export type Topic = typeof topics.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Creative = typeof creatives.$inferSelect;
export type TextFormatting = typeof textFormatting.$inferSelect;
export type Reporting = typeof reporting.$inferSelect;
export type ShareGallery = typeof shareGalleries.$inferSelect;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
