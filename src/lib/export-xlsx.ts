import { eq } from "drizzle-orm";
import xlsx from "node-xlsx";
import { db } from "@/db";
import { listAudiences } from "@/lib/entities/audiences";
import { listTopics } from "@/lib/entities/topics";
import { listMessages } from "@/lib/entities/messages";
import {
  audiences,
  assets,
  creatives,
  messages,
  reporting,
  textFormatting,
  topics,
  type Asset,
  type Audience,
  type Creative,
  type Message,
  type Reporting,
  type TextFormatting,
  type Topic,
} from "@/db/schema";

type Cell = string | number | null;
type Col<T> = { header: string; get: (r: T) => Cell };

function s(v: string | null | undefined): Cell {
  return v ?? null;
}
function num(v: number | null | undefined): Cell {
  return v ?? null;
}

const audienceCols: Col<Audience>[] = [
  { header: "Key", get: (r) => s(r.key) },
  { header: "Name", get: (r) => s(r.name) },
  { header: "Order", get: (r) => num(r.orderIndex) },
  { header: "Status", get: (r) => s(r.status) },
  { header: "Product", get: (r) => s(r.product) },
  { header: "Strategy", get: (r) => s(r.strategy) },
  { header: "Buying_platform", get: (r) => s(r.buyingPlatform) },
  { header: "Data_source", get: (r) => s(r.dataSource) },
  { header: "Targeting_type", get: (r) => s(r.targetingType) },
  { header: "Device", get: (r) => s(r.device) },
  { header: "Tag", get: (r) => s(r.tag) },
  { header: "Comment", get: (r) => s(r.comment) },
  { header: "Campaign_name", get: (r) => s(r.campaignName) },
  { header: "Campaign_ID", get: (r) => s(r.campaignId) },
  { header: "Lineitem_name", get: (r) => s(r.lineitemName) },
  { header: "Lineitem_ID", get: (r) => s(r.lineitemId) },
];

const topicCols: Col<Topic>[] = [
  { header: "Key", get: (r) => s(r.key) },
  { header: "Name", get: (r) => s(r.name) },
  { header: "Order", get: (r) => num(r.orderIndex) },
  { header: "Status", get: (r) => s(r.status) },
  { header: "Product", get: (r) => s(r.product) },
  { header: "Tag", get: (r) => s(r.tag) },
  { header: "Tag1", get: (r) => s(r.tag1) },
  { header: "Tag2", get: (r) => s(r.tag2) },
  { header: "Tag3", get: (r) => s(r.tag3) },
  { header: "Tag4", get: (r) => s(r.tag4) },
  { header: "Created", get: (r) => s(r.created) },
  { header: "Comment", get: (r) => s(r.comment) },
];

const messageCols: Col<Message>[] = [
  { header: "Number", get: (r) => num(r.number) },
  { header: "Variant", get: (r) => s(r.variant) },
  { header: "Audience_Key", get: (r) => s(r.audience) },
  { header: "Topic_Key", get: (r) => s(r.topic) },
  { header: "Version", get: (r) => num(r.versionNo) },
  { header: "PMMID", get: (r) => s(r.pmmid) },
  { header: "Status", get: (r) => s(r.status) },
  { header: "Start_date", get: (r) => s(r.startDate) },
  { header: "End_date", get: (r) => s(r.endDate) },
  { header: "Template", get: (r) => s(r.template) },
  { header: "Template_variant_classes", get: (r) => s(r.templateVariantClasses) },
  { header: "Name", get: (r) => s(r.name) },
  { header: "Headline", get: (r) => s(r.headline) },
  { header: "Copy1", get: (r) => s(r.copy1) },
  { header: "Copy2", get: (r) => s(r.copy2) },
  { header: "Disclaimer", get: (r) => s(r.disclaimer) },
  { header: "Headline_style", get: (r) => s(r.headlineStyle) },
  { header: "Copy1_style", get: (r) => s(r.copy1Style) },
  { header: "Copy2_style", get: (r) => s(r.copy2Style) },
  { header: "Disclaimer_style", get: (r) => s(r.disclaimerStyle) },
  { header: "CSS", get: (r) => s(r.customCss) },
  { header: "Image1", get: (r) => s(r.image1) },
  { header: "Image2", get: (r) => s(r.image2) },
  { header: "Image3", get: (r) => s(r.image3) },
  { header: "Image4", get: (r) => s(r.image4) },
  { header: "Image5", get: (r) => s(r.image5) },
  { header: "Image6", get: (r) => s(r.image6) },
  { header: "Video1", get: (r) => s(r.video1) },
  { header: "Flash", get: (r) => s(r.flash) },
  { header: "Flash_style", get: (r) => s(r.flashStyle) },
  { header: "CTA", get: (r) => s(r.cta) },
  { header: "CTA_style", get: (r) => s(r.ctaStyle) },
  { header: "Landing_URL", get: (r) => s(r.landingUrl) },
  { header: "Comment", get: (r) => s(r.comment) },
  { header: "UTM_Campaign", get: (r) => s(r.utmCampaign) },
  { header: "UTM_Source", get: (r) => s(r.utmSource) },
  { header: "UTM_Medium", get: (r) => s(r.utmMedium) },
  { header: "UTM_Content", get: (r) => s(r.utmContent) },
  { header: "UTM_Term", get: (r) => s(r.utmTerm) },
  { header: "UTM_CD26", get: (r) => s(r.utmCd26) },
  { header: "Final_Trafficked_URL", get: (r) => s(r.finalTraffickedUrl) },
  { header: "Brief", get: (r) => s(r.brief) },
];

const creativeCols: Col<Creative>[] = [
  { header: "Brand", get: (r) => s(r.brand) },
  { header: "Product", get: (r) => s(r.product) },
  { header: "Type", get: (r) => s(r.type) },
  { header: "Template", get: (r) => s(r.template) },
  { header: "Visual_keyword", get: (r) => s(r.visualKeyword) },
  { header: "Visual_description", get: (r) => s(r.copyKeyword) },
  { header: "MC_Number", get: (r) => num(r.mcNumber) },
  { header: "MC_Variant", get: (r) => s(r.mcVariant) },
  { header: "Version", get: (r) => s(r.bannerVersion) },
  { header: "File_format", get: (r) => s(r.fileFormat) },
  { header: "File_driveID", get: (r) => s(r.fileId) },
  { header: "File_name", get: (r) => s(r.fileName) },
  { header: "File_size", get: (r) => s(r.fileSize) },
  { header: "File_dimensions", get: (r) => s(r.fileDimensions) },
  { header: "Comment", get: (r) => s(r.comment) },
];

const assetCols: Col<Asset>[] = [
  { header: "Brand", get: (r) => s(r.brand) },
  { header: "Product", get: (r) => s(r.product) },
  { header: "Type", get: (r) => s(r.type) },
  { header: "Visual_keyword", get: (r) => s(r.visualKeyword) },
  { header: "File_format", get: (r) => s(r.fileFormat) },
  { header: "File_driveID", get: (r) => s(r.fileId) },
  { header: "File_name", get: (r) => s(r.fileName) },
  { header: "File_size", get: (r) => s(r.fileSize) },
  { header: "File_dimensions", get: (r) => s(r.fileDimensions) },
  { header: "Comment", get: (r) => s(r.comment) },
];

const textFormattingCols: Col<TextFormatting>[] = [
  { header: "Text_original", get: (r) => s(r.textOriginal) },
  { header: "Text_formatted", get: (r) => s(r.textFormatted) },
  { header: "Formatting_Scope", get: (r) => s(r.formattingScope) },
  { header: "Formatting_MC_Scope", get: (r) => s(r.formattingMcScope) },
];

const reportingCols: Col<Reporting>[] = [
  { header: "Level", get: (r) => s(r.level) },
  { header: "MC_Label", get: (r) => s(r.mcLabel) },
  { header: "Size", get: (r) => s(r.size) },
  { header: "AdForm_Banner_ID", get: (r) => s(r.bannerId) },
  { header: "AdForm_Banner_Name", get: (r) => s(r.bannerName) },
  { header: "AdForm_Status", get: (r) => s(r.adformStatus) },
  { header: "Impressions", get: (r) => num(r.impressions) },
  { header: "Clicks", get: (r) => num(r.clicks) },
  { header: "CTR", get: (r) => num(r.ctr) },
  { header: "Campaign_ID", get: (r) => s(r.campaignId) },
  { header: "Campaign_Name", get: (r) => s(r.campaignName) },
  { header: "Last_Synced_At", get: (r) => s(r.syncedAt) },
];

function buildSheet<T>(name: string, cols: Col<T>[], rows: T[]) {
  const headers = cols.map((c) => c.header);
  const body = rows.map((r) => cols.map((c) => c.get(r)));
  return { name, data: [headers, ...body], options: {} };
}

export type ExportCounts = {
  audiences: number;
  topics: number;
  messages: number;
  creatives: number;
  assets: number;
  text_formatting: number;
  reporting: number;
};

export type ExportResult = {
  buffer: Buffer;
  counts: ExportCounts;
};

export async function exportClientXlsx(
  clientId: number,
): Promise<ExportResult> {
  const [
    audiencesRows,
    topicsRows,
    messagesRows,
    creativesRows,
    assetsRows,
    textFormattingRows,
    reportingRows,
  ] = await Promise.all([
    db.select().from(audiences).where(eq(audiences.clientId, clientId)),
    db.select().from(topics).where(eq(topics.clientId, clientId)),
    db.select().from(messages).where(eq(messages.clientId, clientId)),
    db.select().from(creatives).where(eq(creatives.clientId, clientId)),
    db.select().from(assets).where(eq(assets.clientId, clientId)),
    db.select().from(textFormatting).where(eq(textFormatting.clientId, clientId)),
    db.select().from(reporting).where(eq(reporting.clientId, clientId)),
  ]);

  const sheets = [
    buildSheet("audiences", audienceCols, audiencesRows),
    buildSheet("topics", topicCols, topicsRows),
    buildSheet("messages", messageCols, messagesRows),
    buildSheet("creatives", creativeCols, creativesRows),
    buildSheet("assets", assetCols, assetsRows),
    buildSheet("textformats", textFormattingCols, textFormattingRows),
    buildSheet("Reporting", reportingCols, reportingRows),
  ];

  const buffer = xlsx.build(sheets);

  return {
    buffer,
    counts: {
      audiences: audiencesRows.length,
      topics: topicsRows.length,
      messages: messagesRows.length,
      creatives: creativesRows.length,
      assets: assetsRows.length,
      text_formatting: textFormattingRows.length,
      reporting: reportingRows.length,
    },
  };
}

// ── Matrix export (filtered, per-product tabs + Audiences/Topics/MCs) ──────
//
// The MCs sheet lists each unique card (number, variant) once. Per-audience
// trafficking fields are dropped: siblings share content via
// propagateToSiblings, but PMMID / UTM_* / Final_Trafficked_URL differ per
// audience copy, so a single row can't represent them.
const MC_EXCLUDED_HEADERS = new Set([
  "Audience_Key",
  "PMMID",
  "Final_Trafficked_URL",
  "UTM_Campaign",
  "UTM_Source",
  "UTM_Medium",
  "UTM_Content",
  "UTM_Term",
  "UTM_CD26",
]);

// Excel sheet names: max 31 chars, no []:*?/\ — and must be unique within the
// workbook (a product could collide after truncation or with a fixed sheet).
function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, "").trim() || "Product").slice(0, 31);
  let candidate = base;
  for (let i = 2; used.has(candidate); i++) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

export async function exportMatrixXlsx(
  clientId: number,
  opts: { products: string[]; statuses: string[] },
): Promise<Buffer> {
  const [allAuds, allTops, allMsgs] = await Promise.all([
    listAudiences(clientId),
    listTopics(clientId),
    listMessages(clientId),
  ]);

  const productSel = new Set(opts.products);
  const statusSel = new Set(opts.statuses);

  const auds = productSel.size
    ? allAuds.filter((a) => a.product && productSel.has(a.product))
    : allAuds;
  const tops = productSel.size
    ? allTops.filter((t) => t.product && productSel.has(t.product))
    : allTops;
  // Grid parity (MatrixGrid filter): active status filter drops null-status rows.
  const msgs = statusSel.size
    ? allMsgs.filter((m) => m.status && statusSel.has(m.status))
    : allMsgs;

  // Tab list = products actually present in the scoped rows (guards stale
  // filter values from localStorage producing empty junk sheets).
  const productNames = [
    ...new Set(
      [...auds, ...tops].map((r) => r.product).filter((p): p is string => !!p),
    ),
  ].sort();

  const usedNames = new Set(["Audiences", "Topics", "MCs"]);
  const audOrder = new Map(auds.map((a, i) => [a.key, i]));

  // A message is in scope when BOTH its audience and topic survive product
  // scoping (same AND rule as the grid and the feed export). Computed from
  // the scoped key sets — not from the product tabs — so cards on
  // null-product audiences still reach the MCs sheet in an unfiltered export.
  const audKeysAll = new Set(auds.map((a) => a.key));
  const topKeysAll = new Set(tops.map((t) => t.key));
  const scopedMsgs = msgs.filter(
    (m) => audKeysAll.has(m.audience) && topKeysAll.has(m.topic),
  );

  const productSheets = productNames.map((product) => {
    const audsP = auds.filter((a) => a.product === product);
    const topsP = tops.filter((t) => t.product === product);
    const audKeys = new Set(audsP.map((a) => a.key));
    const topKeys = new Set(topsP.map((t) => t.key));

    const buckets = new Map<string, Message[]>();
    for (const m of msgs) {
      if (!audKeys.has(m.audience) || !topKeys.has(m.topic)) continue;
      const key = `${m.topic} ${m.audience}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(m);
      else buckets.set(key, [m]);
    }

    const header: Cell[] = ["Topic", "Name", ...audsP.map((a) => a.key)];
    const rows: Cell[][] = topsP.map((t) => [
      t.key,
      t.name,
      ...audsP.map((a) => {
        const bucket = buckets.get(`${t.key} ${a.key}`);
        if (!bucket) return null;
        bucket.sort(
          (x, y) => x.number - y.number || x.variant.localeCompare(y.variant),
        );
        return bucket.map((m) => `MC${m.number}${m.variant}`).join(", ");
      }),
    ]);

    return {
      name: sanitizeSheetName(product, usedNames),
      data: [header, ...rows],
      options: {},
    };
  });

  // MCs sheet: one row per unique (number, variant); representative = the
  // sibling on the first audience in matrix order (content fields are synced
  // across siblings, so the pick only needs to be deterministic).
  const byCard = new Map<string, Message[]>();
  for (const m of scopedMsgs) {
    const key = `${m.number}|${m.variant}`;
    const group = byCard.get(key);
    if (group) group.push(m);
    else byCard.set(key, [m]);
  }
  const mcRows = [...byCard.values()]
    .map((group) => {
      group.sort(
        (x, y) =>
          (audOrder.get(x.audience) ?? 0) - (audOrder.get(y.audience) ?? 0) ||
          x.id - y.id,
      );
      return {
        m: group[0]!,
        audiences: group.map((g) => g.audience).join(", "),
      };
    })
    .sort(
      (x, y) =>
        x.m.number - y.m.number || x.m.variant.localeCompare(y.m.variant),
    );

  type McRow = (typeof mcRows)[number];
  const mcCols: Col<McRow>[] = messageCols
    .filter((c) => !MC_EXCLUDED_HEADERS.has(c.header))
    .map((c) => ({ header: c.header, get: (r: McRow) => c.get(r.m) }));
  mcCols.splice(2, 0, { header: "Audiences", get: (r) => r.audiences });

  const sheets = [
    ...productSheets,
    buildSheet("Audiences", audienceCols, auds),
    buildSheet("Topics", topicCols, tops),
    buildSheet("MCs", mcCols, mcRows),
  ];

  return xlsx.build(sheets);
}
