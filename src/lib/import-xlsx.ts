import { eq } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import xlsx from "node-xlsx";
import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  audiences,
  assets,
  creatives,
  keywords,
  messages,
  reporting,
  textFormatting,
  topics,
} from "@/db/schema";
import { KEYWORD_FIELDS, type KeywordForm } from "@/lib/entities/keywords";

// A db handle that is either the root connection or an open transaction. The
// dry-run path MUST pass the transaction handle through to every write — in
// Postgres the root `db` uses a different pooled connection, so writes issued
// on it would escape the transaction and never roll back.
type Tx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
type DbHandle = typeof db | Tx;

type Row = unknown[];
type Sheet = { name: string; data: Row[] };

export type ImportCounts = {
  audiences: number;
  topics: number;
  messages: number;
  creatives: number;
  assets: number;
  text_formatting: number;
  reporting: number;
  keywords: number;
};

export type ImportResult = {
  inserted: ImportCounts;
  skipped: ImportCounts;
  errors: string[];
};

export type ImportOptions = {
  clientId: number;
  wipeFirst?: boolean;
  /** If true, runs all writes inside a single transaction and rolls back at the end. */
  dryRun?: boolean;
};

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}

function findCol(headers: string[], ...candidates: string[]): number {
  const norm = (x: string) => x.toLowerCase().replace(/[\s_-]+/g, "");
  const normHeaders = headers.map((h) => norm(h ?? ""));
  for (const c of candidates) {
    const i = normHeaders.indexOf(norm(c));
    if (i >= 0) return i;
  }
  return -1;
}

export function emptyCounts(): ImportCounts {
  return {
    audiences: 0,
    topics: 0,
    messages: 0,
    creatives: 0,
    assets: 0,
    text_formatting: 0,
    reporting: 0,
    keywords: 0,
  };
}

export async function importErsteXlsx(
  input: string | Buffer,
  opts: ImportOptions,
): Promise<ImportResult> {
  const { clientId, wipeFirst, dryRun } = opts;
  const sheets = xlsx.parse(input, { raw: true }) as Sheet[];
  const byName = new Map<string, Row[]>(sheets.map((s) => [s.name, s.data]));

  const inserted = emptyCounts();
  const skipped = emptyCounts();
  const errors: string[] = [];

  const work = async (dbh: DbHandle) => {
    if (wipeFirst) {
      // Wipe order: children first (messages reference audience/topic keys),
      // then siblings, finally parents. Keywords has no FK to other entities
      // (only to clients) so it can wipe at any point — grouped with the
      // other tenant-scoped wipes for consistency.
      await dbh.delete(reporting).where(eq(reporting.clientId, clientId));
      await dbh.delete(textFormatting).where(eq(textFormatting.clientId, clientId));
      await dbh.delete(assets).where(eq(assets.clientId, clientId));
      await dbh.delete(creatives).where(eq(creatives.clientId, clientId));
      await dbh.delete(messages).where(eq(messages.clientId, clientId));
      await dbh.delete(topics).where(eq(topics.clientId, clientId));
      await dbh.delete(audiences).where(eq(audiences.clientId, clientId));
      await dbh.delete(keywords).where(eq(keywords.clientId, clientId));
    }

    await importAudiences(dbh, byName.get("audiences"), clientId, inserted, skipped, errors);
    await importTopics(dbh, byName.get("topics"), clientId, inserted, skipped, errors);
    await importMessages(
      dbh,
      byName.get("messages"),
      byName.get("AI messages"),
      clientId,
      inserted,
      skipped,
      errors,
    );
    await importCreatives(dbh, byName.get("creatives"), clientId, inserted, skipped, errors);
    await importAssets(dbh, byName.get("assets"), clientId, inserted, skipped, errors);
    await importTextFormatting(dbh, byName.get("textformats"), clientId, inserted, skipped, errors);
    await importReporting(dbh, byName.get("Reporting"), clientId, inserted, skipped, errors);
    await importKeywords(dbh, byName.get("keywords"), clientId, inserted, skipped, errors);
  };

  if (dryRun) {
    try {
      await db.transaction(async (tx) => {
        await work(tx);
        throw new RollbackForDryRun();
      });
    } catch (e) {
      if (!(e instanceof RollbackForDryRun)) throw e;
    }
  } else {
    await work(db);
  }

  return { inserted, skipped, errors };
}

class RollbackForDryRun extends Error {
  constructor() {
    super("dry-run rollback");
  }
}

async function importAudiences(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("audiences sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    name: findCol(headers, "Name"),
    order: findCol(headers, "Order"),
    status: findCol(headers, "Status"),
    product: findCol(headers, "Product"),
    strategy: findCol(headers, "Strategy"),
    bp: findCol(headers, "Buying_platform", "BuyingPlatform"),
    ds: findCol(headers, "Data_source", "DataSource"),
    tt: findCol(headers, "Targeting_type", "TargetingType"),
    device: findCol(headers, "Device"),
    tag: findCol(headers, "Tag"),
    key: findCol(headers, "Key"),
    comment: findCol(headers, "Comment"),
    cn: findCol(headers, "Campaign_name", "CampaignName"),
    ci: findCol(headers, "Campaign_ID", "CampaignId"),
    ln: findCol(headers, "Lineitem_name", "LineitemName"),
    li: findCol(headers, "Lineitem_ID", "LineitemId"),
  };
  const seen = new Set<string>();
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    const key = s(r[idx.key]);
    if (!key) {
      skipped.audiences++;
      continue;
    }
    if (seen.has(key)) {
      skipped.audiences++;
      continue;
    }
    seen.add(key);
    await dbh
      .insert(audiences)
      .values({
        clientId,
        key,
        name: s(r[idx.name]) ?? key,
        orderIndex: n(r[idx.order]) ?? 0,
        status: s(r[idx.status]),
        product: s(r[idx.product]),
        strategy: s(r[idx.strategy]),
        buyingPlatform: s(r[idx.bp]),
        dataSource: s(r[idx.ds]),
        targetingType: s(r[idx.tt]),
        device: s(r[idx.device]),
        tag: s(r[idx.tag]),
        comment: s(r[idx.comment]),
        campaignName: s(r[idx.cn]),
        campaignId: s(r[idx.ci]),
        lineitemName: s(r[idx.ln]),
        lineitemId: s(r[idx.li]),
      })
      .onConflictDoNothing();
    inserted.audiences++;
  }
}

async function importTopics(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("topics sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    name: findCol(headers, "Name"),
    key: findCol(headers, "Key"),
    order: findCol(headers, "Order"),
    status: findCol(headers, "Status"),
    product: findCol(headers, "Product"),
    tag1: findCol(headers, "Tag1"),
    tag2: findCol(headers, "Tag2"),
    tag3: findCol(headers, "Tag3"),
    tag4: findCol(headers, "Tag4"),
    created: findCol(headers, "Created"),
    comment: findCol(headers, "Comment"),
  };
  const seen = new Set<string>();
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    const key = s(r[idx.key]);
    if (!key) {
      skipped.topics++;
      continue;
    }
    if (seen.has(key)) {
      skipped.topics++;
      continue;
    }
    seen.add(key);
    await dbh
      .insert(topics)
      .values({
        clientId,
        key,
        name: s(r[idx.name]) ?? key,
        orderIndex: n(r[idx.order]) ?? 0,
        status: s(r[idx.status]),
        product: s(r[idx.product]),
        tag1: s(r[idx.tag1]),
        tag2: s(r[idx.tag2]),
        tag3: s(r[idx.tag3]),
        tag4: s(r[idx.tag4]),
        created: s(r[idx.created]),
        comment: s(r[idx.comment]),
      })
      .onConflictDoNothing();
    inserted.topics++;
  }
}

async function importMessages(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  aiSheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("messages sheet missing");
    return;
  }
  const all: Row[] = [];
  all.push(...(sheet as Row[]));
  if (aiSheet && aiSheet.length > 1) {
    // Reuse messages headers; AI messages sheet has same shape per inspection.
    all.push(...(aiSheet.slice(1) as Row[]));
  }
  const headers = sheet[0] as string[];
  const idx = {
    name: findCol(headers, "Name"),
    number: findCol(headers, "Number"),
    variant: findCol(headers, "Variant"),
    audKey: findCol(headers, "Audience_Key", "AudienceKey"),
    topKey: findCol(headers, "Topic_Key", "TopicKey"),
    versionNo: findCol(headers, "Version"),
    pmmid: findCol(headers, "PMMID"),
    status: findCol(headers, "Status"),
    start: findCol(headers, "Start_date", "StartDate"),
    end: findCol(headers, "End_date", "EndDate"),
    template: findCol(headers, "Template"),
    tvc: findCol(headers, "Template_variant_classes", "TemplateVariantClasses"),
    headline: findCol(headers, "Headline"),
    copy1: findCol(headers, "Copy1"),
    copy2: findCol(headers, "Copy2"),
    disclaimer: findCol(headers, "Disclaimer"),
    headlineStyle: findCol(headers, "Headline_style", "HeadlineStyle"),
    copy1Style: findCol(headers, "Copy1_style", "Copy1Style"),
    copy2Style: findCol(headers, "Copy2_style", "Copy2Style"),
    disclaimerStyle: findCol(headers, "Disclaimer_style", "DisclaimerStyle"),
    css: findCol(headers, "CSS"),
    img1: findCol(headers, "Image1"),
    img2: findCol(headers, "Image2"),
    img3: findCol(headers, "Image3"),
    img4: findCol(headers, "Image4"),
    img5: findCol(headers, "Image5"),
    img6: findCol(headers, "Image6"),
    video1: findCol(headers, "Video1"),
    flash: findCol(headers, "Flash"),
    flashStyle: findCol(headers, "Flash_style", "FlashStyle"),
    cta: findCol(headers, "CTA"),
    ctaStyle: findCol(headers, "CTA_style", "CTAStyle"),
    landingUrl: findCol(headers, "Landing_URL", "LandingUrl"),
    comment: findCol(headers, "Comment"),
    utmCampaign: findCol(headers, "UTM_Campaign", "UtmCampaign"),
    utmSource: findCol(headers, "UTM_Source", "UtmSource"),
    utmMedium: findCol(headers, "UTM_Medium", "UtmMedium"),
    utmContent: findCol(headers, "UTM_Content", "UtmContent"),
    utmTerm: findCol(headers, "UTM_Term", "UtmTerm"),
    utmCd26: findCol(headers, "UTM_CD26", "UtmCd26"),
    finalUrl: findCol(headers, "Final_Trafficked_URL", "FinalTraffickedUrl"),
  };

  for (let i = 1; i < all.length; i++) {
    const r = all[i] as Row;
    if (!r || r.length === 0) continue;
    const number = n(r[idx.number]);
    const variant = s(r[idx.variant]);
    const audKey = s(r[idx.audKey]);
    const topKey = s(r[idx.topKey]);
    if (number === null || !variant || !audKey || !topKey) {
      skipped.messages++;
      continue;
    }

    await dbh.insert(messages).values({
      clientId,
      number,
      variant,
      audience: audKey,
      topic: topKey,
      versionNo: n(r[idx.versionNo]) ?? 1,
      pmmid: s(r[idx.pmmid]),
      status: s(r[idx.status]),
      startDate: s(r[idx.start]),
      endDate: s(r[idx.end]),
      template: s(r[idx.template]),
      templateVariantClasses: s(r[idx.tvc]),
      name: s(r[idx.name]),
      headline: s(r[idx.headline]),
      copy1: s(r[idx.copy1]),
      copy2: s(r[idx.copy2]),
      disclaimer: s(r[idx.disclaimer]),
      headlineStyle: s(r[idx.headlineStyle]),
      copy1Style: s(r[idx.copy1Style]),
      copy2Style: s(r[idx.copy2Style]),
      disclaimerStyle: s(r[idx.disclaimerStyle]),
      customCss: s(r[idx.css]),
      image1: s(r[idx.img1]),
      image2: s(r[idx.img2]),
      image3: s(r[idx.img3]),
      image4: s(r[idx.img4]),
      image5: s(r[idx.img5]),
      image6: s(r[idx.img6]),
      video1: s(r[idx.video1]),
      flash: s(r[idx.flash]),
      flashStyle: s(r[idx.flashStyle]),
      cta: s(r[idx.cta]),
      ctaStyle: s(r[idx.ctaStyle]),
      landingUrl: s(r[idx.landingUrl]),
      comment: s(r[idx.comment]),
      utmCampaign: s(r[idx.utmCampaign]),
      utmSource: s(r[idx.utmSource]),
      utmMedium: s(r[idx.utmMedium]),
      utmContent: s(r[idx.utmContent]),
      utmTerm: s(r[idx.utmTerm]),
      utmCd26: s(r[idx.utmCd26]),
      finalTraffickedUrl: s(r[idx.finalUrl]),
    });
    inserted.messages++;
  }
}

export async function importCreatives(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
  opts: { typeFilter?: string } = {},
): Promise<void> {
  if (!sheet) {
    errors.push("creatives sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    brand: findCol(headers, "Brand"),
    product: findCol(headers, "Product"),
    type: findCol(headers, "Type"),
    visualKeyword: findCol(headers, "Visual_keyword", "VisualKeyword"),
    copyKeyword: findCol(headers, "Visual_description", "CopyKeyword"),
    mcNumber: findCol(headers, "MC_Number", "McNumber"),
    mcVariant: findCol(headers, "MC_Variant", "McVariant"),
    bannerVersion: findCol(headers, "Version"),
    fileFormat: findCol(headers, "File_format", "FileFormat"),
    fileId: findCol(headers, "File_driveID", "FileDriveId", "FileId"),
    fileName: findCol(headers, "File_name", "FileName"),
    fileSize: findCol(headers, "File_size", "FileSize"),
    fileDimensions: findCol(headers, "File_dimensions", "FileDimensions"),
  };
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    if (!r || r.length === 0) {
      skipped.creatives++;
      continue;
    }
    const type = s(r[idx.type]);
    if (opts.typeFilter && type !== opts.typeFilter) {
      skipped.creatives++;
      continue;
    }
    await dbh.insert(creatives).values({
      clientId,
      brand: s(r[idx.brand]),
      product: s(r[idx.product]),
      type,
      visualKeyword: s(r[idx.visualKeyword]),
      copyKeyword: s(r[idx.copyKeyword]),
      mcNumber: n(r[idx.mcNumber]),
      mcVariant: s(r[idx.mcVariant]),
      bannerVersion: s(r[idx.bannerVersion]),
      fileFormat: s(r[idx.fileFormat]),
      fileId: s(r[idx.fileId]),
      fileName: s(r[idx.fileName]),
      fileSize: s(r[idx.fileSize]),
      fileDimensions: s(r[idx.fileDimensions]),
    });
    inserted.creatives++;
  }
}

export async function importAssets(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("assets sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    brand: findCol(headers, "Brand"),
    product: findCol(headers, "Product"),
    type: findCol(headers, "Type"),
    visualKeyword: findCol(headers, "Visual_keyword", "VisualKeyword"),
    fileFormat: findCol(headers, "File_format", "FileFormat"),
    fileId: findCol(headers, "File_driveID", "FileDriveId", "FileId"),
    fileName: findCol(headers, "File_name", "FileName"),
    fileSize: findCol(headers, "File_size", "FileSize"),
    fileDimensions: findCol(headers, "File_dimensions", "FileDimensions"),
  };
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    if (!r || r.length === 0) {
      skipped.assets++;
      continue;
    }
    await dbh.insert(assets).values({
      clientId,
      brand: s(r[idx.brand]),
      product: s(r[idx.product]),
      type: s(r[idx.type]),
      visualKeyword: s(r[idx.visualKeyword]),
      fileFormat: s(r[idx.fileFormat]),
      fileId: s(r[idx.fileId]),
      fileName: s(r[idx.fileName]),
      fileSize: s(r[idx.fileSize]),
      fileDimensions: s(r[idx.fileDimensions]),
    });
    inserted.assets++;
  }
}

async function importTextFormatting(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("textformats sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    original: findCol(headers, "Text_original", "TextOriginal"),
    formatted: findCol(headers, "Text_formatted", "TextFormatted"),
    scope: findCol(headers, "Formatting_Scope", "FormattingScope"),
    mcScope: findCol(headers, "Formatting_MC_Scope", "FormattingMcScope"),
  };
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    const original = s(r[idx.original]);
    const formatted = s(r[idx.formatted]);
    if (!original || !formatted) {
      skipped.text_formatting++;
      continue;
    }
    await dbh.insert(textFormatting).values({
      clientId,
      textOriginal: original,
      textFormatted: formatted,
      formattingScope: s(r[idx.scope]),
      formattingMcScope: s(r[idx.mcScope]),
    });
    inserted.text_formatting++;
  }
}

async function importReporting(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  errors: string[],
): Promise<void> {
  if (!sheet) {
    errors.push("Reporting sheet missing");
    return;
  }
  const headers = sheet[0] as string[];
  const idx = {
    level: findCol(headers, "Level"),
    mcLabel: findCol(headers, "MC_Label", "McLabel"),
    size: findCol(headers, "Size"),
    bannerId: findCol(headers, "AdForm_Banner_ID", "BannerId"),
    bannerName: findCol(headers, "AdForm_Banner_Name", "BannerName"),
    adformStatus: findCol(headers, "AdForm_Status", "AdformStatus"),
    impressions: findCol(headers, "Impressions"),
    clicks: findCol(headers, "Clicks"),
    ctr: findCol(headers, "CTR"),
    campaignId: findCol(headers, "Campaign_ID", "CampaignId"),
    campaignName: findCol(headers, "Campaign_Name", "CampaignName"),
    syncedAt: findCol(headers, "Last_Synced_At", "SyncedAt"),
  };
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    const level = s(r[idx.level]);
    if (!level) {
      skipped.reporting++;
      continue;
    }
    await dbh.insert(reporting).values({
      clientId,
      level,
      mcLabel: s(r[idx.mcLabel]),
      size: s(r[idx.size]),
      bannerId: s(r[idx.bannerId]),
      bannerName: s(r[idx.bannerName]),
      adformStatus: s(r[idx.adformStatus]),
      impressions: n(r[idx.impressions]) ?? 0,
      clicks: n(r[idx.clicks]) ?? 0,
      ctr: n(r[idx.ctr]),
      campaignId: s(r[idx.campaignId]),
      campaignName: s(r[idx.campaignName]),
      syncedAt: s(r[idx.syncedAt]),
    });
    inserted.reporting++;
  }
}

// XLSX `keywords` sheet has columns: form, field, values (comma-separated).
// XLSX field names follow the source naming style (Pascal + snake_case, e.g.
// "Buying_platform", "Data_source", "Targeting_type"). v6 stores the
// camelCase TS column name (`buyingPlatform`, `dataSource`, `targetingType`)
// so we normalize on import: lower-first + snake_case → camelCase.
//
// Exported so the unit test can lock the mapping.
export function normalizeXlsxFieldName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const lowerFirst = trimmed[0].toLowerCase() + trimmed.slice(1);
  return lowerFirst.replace(/_(.)/g, (_, c: string) => c.toUpperCase());
}

async function importKeywords(
  dbh: DbHandle,
  sheet: Row[] | undefined,
  clientId: number,
  inserted: ImportCounts,
  skipped: ImportCounts,
  _errors: string[],
): Promise<void> {
  if (!sheet) {
    // Optional sheet — older XLSX exports may not have it. Silent.
    return;
  }
  // Per-(form, field) running orderIndex so the value display order matches
  // the comma order in the XLSX.
  const counters = new Map<string, number>();
  for (let i = 1; i < sheet.length; i++) {
    const r = sheet[i] as Row;
    if (!r || r.length === 0) continue;
    const form = s(r[0]);
    const rawField = s(r[1]);
    const valuesCell = s(r[2]);
    if (!form || !rawField) {
      skipped.keywords++;
      continue;
    }
    // Form must be one we cover in v1 (audiences | topics). Drop tasks,
    // messages, creatives, assets silently for now.
    if (form !== "audiences" && form !== "topics") {
      skipped.keywords++;
      continue;
    }
    const field = normalizeXlsxFieldName(rawField);
    // Field must be in the allowlist for that form.
    if (!(KEYWORD_FIELDS[form as KeywordForm] as readonly string[]).includes(field)) {
      skipped.keywords++;
      continue;
    }
    if (!valuesCell) {
      // Field declared but no values — no error, just nothing to seed.
      continue;
    }
    const cohortKey = `${form}|${field}`;
    let next = counters.get(cohortKey) ?? 0;
    for (const raw of valuesCell.split(",")) {
      const value = raw.trim();
      if (!value) continue;
      // onConflictDoNothing keeps re-imports idempotent on a wipe-fresh client
      // AND is transaction-safe (a swallowed UNIQUE error would abort the whole
      // Postgres transaction, breaking the dry-run rollback path).
      const res = await dbh
        .insert(keywords)
        .values({ clientId, form, field, value, orderIndex: next })
        .onConflictDoNothing()
        .returning({ id: keywords.id });
      if (res.length > 0) {
        inserted.keywords++;
        next++;
      } else {
        skipped.keywords++;
      }
    }
    counters.set(cohortKey, next);
  }
}
