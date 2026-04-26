// Import a representative sample from the real Erste xlsx into the v6 DB.
// Reads docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx
// Inserts directly (bypasses MC numbering) preserving the v5 number/variant.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste-sample.ts
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste-sample.ts --reset
//
// --reset clears existing audiences/topics/messages for the active client first.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import path from "node:path";
import { eq } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import {
  audiences,
  messages,
  topics,
  type NewClient,
} from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import xlsx from "node-xlsx";

const XLSX_PATH = path.resolve(
  process.cwd(),
  "docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx",
);

const SAMPLE_AUDIENCES = 12;
const SAMPLE_TOPICS = 12;
const SAMPLE_MESSAGES = 40;

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

async function main() {
  const reset = process.argv.includes("--reset");
  const client = getActiveClient();
  console.log(`Active client: ${client.key} (id=${client.id})`);

  const sheets = xlsx.parse(XLSX_PATH, { raw: true });
  const byName = new Map<string, unknown[][]>(
    sheets.map((s: { name: string; data: unknown[][] }) => [s.name, s.data]),
  );

  const audSheet = byName.get("audiences")!;
  const topSheet = byName.get("topics")!;
  const msgSheet = byName.get("messages")!;

  const audHeaders = (audSheet[0] as string[]).map((h) => h?.toLowerCase());
  const topHeaders = (topSheet[0] as string[]).map((h) => h?.toLowerCase());
  const msgHeaders = (msgSheet[0] as string[]).map((h) => h?.toLowerCase());

  function col(headers: string[], name: string) {
    const i = headers.indexOf(name.toLowerCase());
    if (i < 0) throw new Error(`Column not found: ${name}`);
    return i;
  }

  if (reset) {
    console.log("Resetting audiences/topics/messages for client…");
    db.delete(messages).where(eq(messages.clientId, client.id)).run();
    db.delete(topics).where(eq(topics.clientId, client.id)).run();
    db.delete(audiences).where(eq(audiences.clientId, client.id)).run();
  }

  // ── Audiences (top N from xlsx) ──
  const audRows = audSheet.slice(1, SAMPLE_AUDIENCES + 1) as unknown[][];
  const audIdx = {
    name: col(audHeaders, "Name"),
    order: col(audHeaders, "Order"),
    status: col(audHeaders, "Status"),
    product: col(audHeaders, "Product"),
    strategy: col(audHeaders, "Strategy"),
    bp: col(audHeaders, "Buying_platform"),
    ds: col(audHeaders, "Data_source"),
    tt: col(audHeaders, "Targeting_type"),
    device: col(audHeaders, "Device"),
    tag: col(audHeaders, "Tag"),
    key: col(audHeaders, "Key"),
    comment: col(audHeaders, "Comment"),
    cn: col(audHeaders, "Campaign_name"),
    ci: col(audHeaders, "Campaign_ID"),
    ln: col(audHeaders, "Lineitem_name"),
    li: col(audHeaders, "Lineitem_ID"),
  };

  let audInserted = 0;
  const audKeys = new Set<string>();
  for (const r of audRows) {
    const key = s(r[audIdx.key]);
    if (!key || audKeys.has(key)) continue;
    audKeys.add(key);
    db.insert(audiences)
      .values({
        clientId: client.id,
        key,
        name: s(r[audIdx.name]) ?? key,
        orderIndex: n(r[audIdx.order]) ?? 0,
        status: s(r[audIdx.status]),
        product: s(r[audIdx.product]),
        strategy: s(r[audIdx.strategy]),
        buyingPlatform: s(r[audIdx.bp]),
        dataSource: s(r[audIdx.ds]),
        targetingType: s(r[audIdx.tt]),
        device: s(r[audIdx.device]),
        tag: s(r[audIdx.tag]),
        comment: s(r[audIdx.comment]),
        campaignName: s(r[audIdx.cn]),
        campaignId: s(r[audIdx.ci]),
        lineitemName: s(r[audIdx.ln]),
        lineitemId: s(r[audIdx.li]),
      })
      .onConflictDoNothing()
      .run();
    audInserted++;
  }
  console.log(`Audiences inserted: ${audInserted}`);

  // ── Topics ──
  const topRows = topSheet.slice(1, SAMPLE_TOPICS + 1) as unknown[][];
  const topIdx = {
    name: col(topHeaders, "Name"),
    key: col(topHeaders, "Key"),
    order: col(topHeaders, "Order"),
    status: col(topHeaders, "Status"),
    product: col(topHeaders, "Product"),
    tag1: col(topHeaders, "Tag1"),
    tag2: col(topHeaders, "Tag2"),
    tag3: col(topHeaders, "Tag3"),
    tag4: col(topHeaders, "Tag4"),
    created: col(topHeaders, "Created"),
    comment: col(topHeaders, "Comment"),
  };
  let topInserted = 0;
  const topKeys = new Set<string>();
  for (const r of topRows) {
    const key = s(r[topIdx.key]);
    if (!key || topKeys.has(key)) continue;
    topKeys.add(key);
    db.insert(topics)
      .values({
        clientId: client.id,
        key,
        name: s(r[topIdx.name]) ?? key,
        orderIndex: n(r[topIdx.order]) ?? 0,
        status: s(r[topIdx.status]),
        product: s(r[topIdx.product]),
        tag1: s(r[topIdx.tag1]),
        tag2: s(r[topIdx.tag2]),
        tag3: s(r[topIdx.tag3]),
        tag4: s(r[topIdx.tag4]),
        created: s(r[topIdx.created]),
        comment: s(r[topIdx.comment]),
      })
      .onConflictDoNothing()
      .run();
    topInserted++;
  }
  console.log(`Topics inserted: ${topInserted}`);

  // ── Messages — sample only those whose audience+topic both made it in ──
  const msgRows = msgSheet.slice(1) as unknown[][];
  const msgIdx = {
    name: col(msgHeaders, "Name"),
    number: col(msgHeaders, "Number"),
    variant: col(msgHeaders, "Variant"),
    audKey: col(msgHeaders, "Audience_Key"),
    topKey: col(msgHeaders, "Topic_Key"),
    versionNo: col(msgHeaders, "Version"),
    pmmid: col(msgHeaders, "PMMID"),
    status: col(msgHeaders, "Status"),
    start: col(msgHeaders, "Start_date"),
    end: col(msgHeaders, "End_date"),
    template: col(msgHeaders, "Template"),
    tvc: col(msgHeaders, "Template_variant_classes"),
    headline: col(msgHeaders, "Headline"),
    copy1: col(msgHeaders, "Copy1"),
    copy2: col(msgHeaders, "Copy2"),
    disclaimer: col(msgHeaders, "Disclaimer"),
    headlineStyle: col(msgHeaders, "Headline_style"),
    copy1Style: col(msgHeaders, "Copy1_style"),
    copy2Style: col(msgHeaders, "Copy2_style"),
    disclaimerStyle: col(msgHeaders, "Disclaimer_style"),
    css: col(msgHeaders, "CSS"),
    img1: col(msgHeaders, "Image1"),
    img2: col(msgHeaders, "Image2"),
    img3: col(msgHeaders, "Image3"),
    img4: col(msgHeaders, "Image4"),
    img5: col(msgHeaders, "Image5"),
    img6: col(msgHeaders, "Image6"),
    flash: col(msgHeaders, "Flash"),
    flashStyle: col(msgHeaders, "Flash_style"),
    cta: col(msgHeaders, "CTA"),
    ctaStyle: col(msgHeaders, "CTA_style"),
    landingUrl: col(msgHeaders, "Landing_URL"),
    comment: col(msgHeaders, "Comment"),
    utmCampaign: col(msgHeaders, "UTM_Campaign"),
    utmSource: col(msgHeaders, "UTM_Source"),
    utmMedium: col(msgHeaders, "UTM_Medium"),
    utmContent: col(msgHeaders, "UTM_Content"),
    utmTerm: col(msgHeaders, "UTM_Term"),
    utmCd26: col(msgHeaders, "UTM_CD26"),
    finalUrl: col(msgHeaders, "Final_Trafficked_URL"),
  };

  let msgInserted = 0;
  for (const r of msgRows) {
    if (msgInserted >= SAMPLE_MESSAGES) break;
    const audKey = s(r[msgIdx.audKey]);
    const topKey = s(r[msgIdx.topKey]);
    if (!audKey || !topKey) continue;
    if (!audKeys.has(audKey) || !topKeys.has(topKey)) continue;
    const number = n(r[msgIdx.number]);
    const variant = s(r[msgIdx.variant]);
    if (number === null || !variant) continue;

    db.insert(messages)
      .values({
        clientId: client.id,
        number,
        variant,
        audience: audKey,
        topic: topKey,
        versionNo: n(r[msgIdx.versionNo]) ?? 1,
        pmmid: s(r[msgIdx.pmmid]),
        status: s(r[msgIdx.status]),
        startDate: s(r[msgIdx.start]),
        endDate: s(r[msgIdx.end]),
        template: s(r[msgIdx.template]),
        templateVariantClasses: s(r[msgIdx.tvc]),
        name: s(r[msgIdx.name]),
        headline: s(r[msgIdx.headline]),
        copy1: s(r[msgIdx.copy1]),
        copy2: s(r[msgIdx.copy2]),
        disclaimer: s(r[msgIdx.disclaimer]),
        headlineStyle: s(r[msgIdx.headlineStyle]),
        copy1Style: s(r[msgIdx.copy1Style]),
        copy2Style: s(r[msgIdx.copy2Style]),
        disclaimerStyle: s(r[msgIdx.disclaimerStyle]),
        customCss: s(r[msgIdx.css]),
        image1: s(r[msgIdx.img1]),
        image2: s(r[msgIdx.img2]),
        image3: s(r[msgIdx.img3]),
        image4: s(r[msgIdx.img4]),
        image5: s(r[msgIdx.img5]),
        image6: s(r[msgIdx.img6]),
        flash: s(r[msgIdx.flash]),
        flashStyle: s(r[msgIdx.flashStyle]),
        cta: s(r[msgIdx.cta]),
        ctaStyle: s(r[msgIdx.ctaStyle]),
        landingUrl: s(r[msgIdx.landingUrl]),
        comment: s(r[msgIdx.comment]),
        utmCampaign: s(r[msgIdx.utmCampaign]),
        utmSource: s(r[msgIdx.utmSource]),
        utmMedium: s(r[msgIdx.utmMedium]),
        utmContent: s(r[msgIdx.utmContent]),
        utmTerm: s(r[msgIdx.utmTerm]),
        utmCd26: s(r[msgIdx.utmCd26]),
        finalTraffickedUrl: s(r[msgIdx.finalUrl]),
      })
      .run();
    msgInserted++;
  }
  console.log(`Messages inserted: ${msgInserted}`);
  getSqlite().close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
