import { eq } from "drizzle-orm";
import xlsx from "node-xlsx";
import { db } from "@/db";
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
  { header: "Strategy", get: (r) => s(r.strategy) },
  { header: "Buying_platform", get: (r) => s(r.buyingPlatform) },
  { header: "Data_source", get: (r) => s(r.dataSource) },
  { header: "Targeting_type", get: (r) => s(r.targetingType) },
  { header: "Device", get: (r) => s(r.device) },
  { header: "Tag", get: (r) => s(r.tag) },
  { header: "Tag1", get: (r) => s(r.tag1) },
  { header: "Tag2", get: (r) => s(r.tag2) },
  { header: "Tag3", get: (r) => s(r.tag3) },
  { header: "Tag4", get: (r) => s(r.tag4) },
  { header: "Created", get: (r) => s(r.created) },
  { header: "Comment", get: (r) => s(r.comment) },
  { header: "Campaign_name", get: (r) => s(r.campaignName) },
  { header: "Campaign_ID", get: (r) => s(r.campaignId) },
  { header: "Lineitem_name", get: (r) => s(r.lineitemName) },
  { header: "Lineitem_ID", get: (r) => s(r.lineitemId) },
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

export function exportClientXlsx(clientId: number): ExportResult {
  const audiencesRows = db
    .select()
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .all();
  const topicsRows = db
    .select()
    .from(topics)
    .where(eq(topics.clientId, clientId))
    .all();
  const messagesRows = db
    .select()
    .from(messages)
    .where(eq(messages.clientId, clientId))
    .all();
  const creativesRows = db
    .select()
    .from(creatives)
    .where(eq(creatives.clientId, clientId))
    .all();
  const assetsRows = db
    .select()
    .from(assets)
    .where(eq(assets.clientId, clientId))
    .all();
  const textFormattingRows = db
    .select()
    .from(textFormatting)
    .where(eq(textFormatting.clientId, clientId))
    .all();
  const reportingRows = db
    .select()
    .from(reporting)
    .where(eq(reporting.clientId, clientId))
    .all();

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
