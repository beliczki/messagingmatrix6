import {
  pgTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
  check,
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
    // Agentic scoping. NULL = DCO audience (template-driven matrix). A prodlist
    // channel value (DISP|SOC|PRG|GSN|GNW|YT) = an Agentic channel-audience.
    // The DCO/Agentic matrix views partition on IS NULL vs IS NOT NULL.
    channel: text("channel"),
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
    index("audiences_client_channel_idx").on(t.clientId, t.channel),
  ],
);

// Agentic channels — first-class, separate from audiences (2026-08-17). Each row
// is a column of the Agentic matrix. `key` (e.g. "ch_disp") is what Agentic
// messages store in `messages.audience`; `code` (e.g. "DISP") is the prodlist
// channel value; `label` is the display name. Channels used to live as
// `audiences.channel != null` rows — they were migrated out so the audiences
// list stays DCO-only. Agentic MCs are minted only via creative promotion.
export const channels = pgTable(
  "channels",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    orderIndex: integer("order_index").notNull(),
    createdAt: text("created_at").notNull().default(nowUtc),
    updatedAt: text("updated_at").notNull().default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("channels_client_key_unique").on(t.clientId, t.key),
    index("channels_client_code_idx").on(t.clientId, t.code),
    index("channels_client_order_idx").on(t.clientId, t.orderIndex),
  ],
);
export type Channel = typeof channels.$inferSelect;

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

// The reason a DRAFT exists: the Google Slides deck a piece of work came in on.
// Deliberately NOT a work-item entity — no state, owner, due date or revision
// seal. Several drafts share one brief, so it needs an identity, and identity is
// the FILE ID, never the URL: the same deck arrives as `?usp=sharing`, with a
// `/u/0/` prefix and with a `#slide=` fragment, and three spellings of one deck
// would read as three briefs. (Same reasoning as creatives.drive_folder_id.)
export const briefs = pgTable(
  "briefs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // Google Drive file ID of the Slides deck, extracted from whatever URL the
    // user pasted. One row per deck per client.
    slidesFileId: text("slides_file_id").notNull(),
    // Human label for the drafts list. Typed or pasted by the user — the keyed
    // Drive API cannot read a file's title without OAuth, so this is not fetched.
    label: text("label"),
    createdAt: text("created_at")
      .notNull()
      .default(nowUtc),
    updatedAt: text("updated_at")
      .notNull()
      .default(nowUtc),
    archivedAt: text("archived_at"),
  },
  (t) => [
    uniqueIndex("briefs_client_slides_file_unique").on(t.clientId, t.slidesFileId),
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
    // NULL on a DRAFT row and only there — see the status comment below. Every
    // other row is placed in a cell, and the pair below is what a cell IS, so a
    // placed row without them would be unreachable from the grid.
    audience: text("audience"),
    // NULL while a DRAFT has not been given one. On a DRAFT this is a SUGGESTED
    // NAME and need not resolve to a `topics` row; promotion is what forces it
    // to a real key (createMessage rejects an unknown topic). Nothing joins on
    // it strictly, so a dangling draft value is inert rather than broken.
    topic: text("topic"),
    // The Slides deck this work came in on. Nullable everywhere: a draft may
    // predate its brief, and matrix rows created before this column keep NULL.
    briefId: integer("brief_id").references(() => briefs.id, {
      onDelete: "set null",
    }),
    // Which SLIDE of that deck this card was briefed on — the Google page
    // object id (`g123abc_0_1`) out of a `#slide=id.g...` deep link, not the
    // fragment as pasted. The brief is the deck (one row, shared by many
    // cards); the slide is per card, which is why it lives here and not on
    // `briefs`. NULL = no anchor, and the preview then opens the deck at its
    // first slide rather than guessing.
    briefSlideId: text("brief_slide_id"),
    // The product a DRAFT belongs to — and ONLY a draft, which is why the
    // column says so in its name rather than in a comment somebody has to find.
    //
    // A placed card's product is DERIVED from its cell: `audiences.product` on
    // the DCO axis, the topic key prefix on the Agentic one (see
    // dashboard-products.ts, where that rule is marked correctness-critical). A
    // draft has neither — no audience, and a topic that is free text — so for
    // that one state the product has nowhere to be derived from and has to be
    // stored. Promotion gives the row a cell and the derivation takes over;
    // this value is then dead, never read, never reconciled. Naming it
    // `product` would invite exactly the second source of truth that would
    // then drift from the matrix and the dashboard.
    draftProduct: text("draft_product"),
    versionNo: integer("version_no").notNull().default(1),
    pmmid: text("pmmid"),
    // "No status" is not a legal state for an MC: a status-less row is invisible
    // to the matrix status filter (it matches no option and cannot be filtered
    // FOR), so it silently drops out of every status-scoped view. NOT NULL keeps
    // it that way; the default covers inserts that omit the column entirely —
    // ACTIVE because the rows that reach us without one are delivered creatives.
    // Hand-created MCs are unaffected: createMessage passes INCOMING explicitly
    // (slice 5 of the DRAFT epic replaces that birth status with PREVIEW).
    //
    // DRAFT is the pre-matrix state: work that has been taken on and has claimed
    // its MC number, but has not been placed in a cell yet. It is not a separate
    // table — a draft is a `messages` row so that number allocation, variants,
    // versioning and previews all work unchanged (isLive counts every unarchived
    // row regardless of status, so a draft's number is reserved from T0). What
    // keeps it out of the matrix is the ABSENCE OF AN AUDIENCE, enforced by the
    // check constraint below rather than by discipline: two independent
    // discriminators for one concept drift apart.
    status: text("status").notNull().default("ACTIVE"),
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
    index("messages_client_brief_idx").on(t.clientId, t.briefId),
    // DRAFT ⟺ no audience, in both directions. The forward half stops a draft
    // from hiding inside a real cell; the reverse half stops a placed row from
    // losing its column and silently vanishing from the grid.
    check(
      "messages_draft_has_no_audience",
      sql`(${t.status} = 'DRAFT') = (${t.audience} IS NULL)`,
    ),
    // A cell IS an (audience, topic) pair, so a placed row needs both. Only a
    // draft may go without — and it may go without either one, since at T0 all
    // it has is its number. Together with the check above this makes "has an
    // audience" a sound narrowing to "has a topic too", which is what lets the
    // matrix code treat a placed row as fully keyed.
    check(
      "messages_placed_has_topic",
      sql`${t.audience} IS NULL OR ${t.topic} IS NOT NULL`,
    ),
    // A draft has no PMMID: the measurement key encodes audience/topic/number/
    // variant, so minting one before placement would name a cell that does not
    // exist. Enforcing it here is what makes getMessageByPmmid provably
    // draft-free — and that lookup is how copy and move resolve their sources,
    // the two operations where picking up the wrong row is most expensive.
    check(
      "messages_draft_has_no_pmmid",
      sql`${t.status} != 'DRAFT' OR ${t.pmmid} IS NULL`,
    ),
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

// The draft_messages / draft_previews tables were RETIRED on 2026-09-04: a
// draft is now a `messages` row with no audience, so it reuses the message
// numbering, versioning and preview machinery instead of shadowing it. Both
// tables were empty on every client, so nothing was migrated. See
// tasks/todo.md "DRAFT-modell + státusz-takarítás epic".

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
    // Google Drive delivery location (I4). The folder is what the user pastes
    // at upload time and can edit later; the file id is *computed* by listing
    // that folder and matching file_name, so it is read-only in the UI. IDs,
    // not URLs: a pasted link arrives in many shapes (?usp=sharing, /u/0/) and
    // the share header groups creatives by folder. checked_at is the last
    // resolve attempt — folder set + file null + checked_at set = "not found".
    driveFolderId: text("drive_folder_id"),
    driveFolderName: text("drive_folder_name"),
    driveFileId: text("drive_file_id"),
    driveCheckedAt: text("drive_checked_at"),
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
    // the single day this row covers, ISO `YYYY-MM-DD`. The source report has
    // carried a per-day `Date` column all along; the importer used to fold it
    // away. ISO rather than the report's own DD/MM/YYYY because the whole point
    // of the column is to be ordered and ranged on, and DD/MM/YYYY sorts
    // December 2025 after May 2026. "" means "no day breakdown" — a period the
    // importer folded whole, exactly as `size` uses "" for "no size token" —
    // which also keeps the unique index below free of NULLs.
    day: text("day").notNull().default(""),
    importedAt: text("imported_at")
      .notNull()
      .default(nowUtc),
    sourceFilename: text("source_filename"),
  },
  (t) => [
    index("monitoring_client_message_idx").on(t.clientId, t.messageId),
    index("monitoring_client_platform_idx").on(t.clientId, t.platform),
    index("monitoring_client_mc_idx").on(t.clientId, t.mcNumber, t.mcVariant),
    index("monitoring_client_day_idx").on(t.clientId, t.day),
    // one row per (platform, message-key, size, day) per period — re-upload
    // replaces the whole period, so a period is never half day-grained.
    uniqueIndex("monitoring_client_period_key_idx").on(
      t.clientId,
      t.platform,
      t.periodFrom,
      t.periodTo,
      t.day,
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
    // Which platform this feed was built for. A product legitimately has two
    // live feeds at once — AdForm and DV360 each get their own, with their own
    // signal header and their own lineitems — so "which export is live" and the
    // version line it belongs to are per (product, platform), never per product.
    // Existing rows are all AdForm: every stored payload carries
    // AdformSignal:ADFPLAID.
    platform: text("platform").notNull().default("adform"),
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

// Prodlist ingest (FR-A, deliverable-grain). One row per prodlist deliverable
// (a production unit × required asset). Source of the Agentic channel set
// (DISP/SOC/PRG/GSN/GNW/YT) and the creative→channel classification target.
// `deliverableId` is the stable source hash, unique per client → idempotent
// upsert. `mcNumber`/`mcVariant` are the soft-link to the promoted message,
// mirroring `creatives`.
export const prodlistRows = pgTable(
  "prodlist_rows",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    deliverableId: text("deliverable_id").notNull(),
    productionUnitId: text("production_unit_id"),
    channel: text("channel"),
    campaign: text("campaign"),
    format: text("format"),
    requiredAsset: text("required_asset"),
    flightStart: text("flight_start"),
    flightEnd: text("flight_end"),
    sourceRef: text("source_ref"),
    familyKey: text("family_key"),
    mcNumber: integer("mc_number"),
    mcVariant: text("mc_variant"),
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
    uniqueIndex("prodlist_rows_client_deliverable_unique").on(
      t.clientId,
      t.deliverableId,
    ),
    index("prodlist_rows_client_channel_idx").on(t.clientId, t.channel),
    index("prodlist_rows_client_mc_idx").on(t.clientId, t.mcNumber, t.mcVariant),
    index("prodlist_rows_client_family_idx").on(t.clientId, t.familyKey),
  ],
);

export type ProdlistRow = typeof prodlistRows.$inferSelect;
export type NewProdlistRow = typeof prodlistRows.$inferInsert;

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
export type Brief = typeof briefs.$inferSelect;
export type NewBrief = typeof briefs.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type Creative = typeof creatives.$inferSelect;
export type TextFormatting = typeof textFormatting.$inferSelect;
export type Reporting = typeof reporting.$inferSelect;
export type ShareGallery = typeof shareGalleries.$inferSelect;
export type ShareComment = typeof shareComments.$inferSelect;
export type UploadedFile = typeof uploadedFiles.$inferSelect;
