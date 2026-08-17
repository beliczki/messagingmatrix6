// Rebuild the Creative Library for ONE product from the local ground-truth
// folder, then fill the nonDCO matrix with template-less MC mirrors + previews.
//
// Ground truth: ~/ERSTE Addressable AI Agent/creatives/ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<ver>_<WxH>.<ext>
//
// Per-product pipeline (scoped to one product; IDEMPOTENT — safe to re-run):
//   0. hard-delete the product's existing nonDCO messages (image1 ERSTE_<PROD>_%
//      on a channel audience) so a re-run doesn't duplicate them.
//   1. hard-delete the product's `creatives` rows + `uploaded_files`
//      (ERSTE_<PROD>_%). MinIO bytes are LEFT intact (safety net; the caller has
//      dumped both tables to a restorable CSV).
//   2. hard-delete the product's Adobe PSD DCO MCs (template='Adobe PSD',
//      audience.product = PROD) — these static creatives move to nonDCO.
//   3. reimport every image/video file: uploadFile (bytes → MinIO + uploaded_files)
//      + createCreative (parsed metadata).
//   4. generate nonDCO MCs by DIRECT INSERT (pmmid + trafficking via the real
//      generators). One message per (mcNumber|MC0-family, variant, channel):
//      template=null + image1=representative file, on the channel-audience, at a
//      per-NUMBER topic (= the number's variant-'a' keyword). MC number/variant
//      come from the filename; MC0 → a fresh number above the global max.
//      Direct insert (not createMessage) so a nonDCO number can PAIR a DCO
//      number in a different topic (cross-axis reuse), and so a number can carry
//      different variants across channel cells — neither of which createMessage's
//      DCO-oriented guards allow.
//
// Channel from size (user-locked, v1): 1080x1080 + 1200x628 → SOC, else DISP.
//
// Usage (dry-run prints the plan, writes nothing):
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=... npx tsx scripts/rebuild-creatives.ts LTP
//   ACTIVE_CLIENT_KEY=erste DATABASE_URL=... npx tsx scripts/rebuild-creatives.ts LTP --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import path from "node:path";
import { and, eq, like, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  creatives,
  messages,
  uploadedFiles,
  audiences,
  topics,
  config as configTable,
} from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { parseCreativeFilename } from "../src/lib/parse-creative-filename";
import { uploadFile } from "../src/lib/entities/files";
import { createCreative, updateCreative } from "../src/lib/entities/creatives";
import { generatePmmid } from "../src/lib/pmmid";
import { buildTrafficking } from "../src/lib/trafficking";

const SRC_DIR = "/Users/robertbeliczki/ERSTE Addressable AI Agent/creatives";
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm"]);
const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};
const SOC_SIZES = new Set(["1080x1080", "1200x628"]);
type Channel = "SOC" | "DISP";
const AUD: Record<Channel, string> = { SOC: "ch_soc", DISP: "ch_disp" };
const CHANNEL_AUDS = ["ch_disp", "ch_soc", "ch_prg", "ch_gsn", "ch_gnw", "ch_yt"];

type Rec = {
  file: string;
  filename: string;
  ext: string;
  type: "image" | "video";
  product: string;
  mcNumber: number | null;
  mcVariant: string;
  topicRaw: string;
  version: number;
  dims: string | null;
  channel: Channel;
  familyKey: string;
};

function underscoredTopic(keywords: string): string {
  return keywords.trim().split(/\s+/).filter(Boolean).join("_");
}

function scanProduct(product: string): Rec[] {
  const prefix = `ERSTE_${product}_`;
  const out: Rec[] = [];
  for (const name of fs.readdirSync(SRC_DIR)) {
    if (!name.startsWith(prefix)) continue;
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const type = IMAGE_EXT.has(ext)
      ? "image"
      : VIDEO_EXT.has(ext)
        ? "video"
        : null;
    if (!type) continue; // skip zip/html/css/js/etc.
    const p = parseCreativeFilename(name);
    const dims = p.declaredDimensions;
    const channel: Channel = dims && SOC_SIZES.has(dims) ? "SOC" : "DISP";
    out.push({
      file: path.join(SRC_DIR, name),
      filename: name,
      ext,
      type,
      product,
      mcNumber: p.mcNumber,
      mcVariant: (p.mcVariant ?? "").toLowerCase(),
      topicRaw: underscoredTopic(p.keywords),
      version: p.version,
      dims,
      channel,
      familyKey: p.familyKey,
    });
  }
  return out;
}

// Per-NUMBER topic = the number's variant-'a' keyword (fallback: lowest variant).
function topicByNumber(recs: Rec[]): Map<number, string> {
  const byNum = new Map<number, Rec[]>();
  for (const r of recs) {
    if (r.mcNumber == null || r.mcNumber === 0) continue;
    const list = byNum.get(r.mcNumber) ?? [];
    list.push(r);
    byNum.set(r.mcNumber, list);
  }
  const out = new Map<number, string>();
  for (const [num, list] of byNum) {
    const sorted = [...list].sort((a, b) => a.mcVariant.localeCompare(b.mcVariant));
    const va = sorted.find((r) => r.mcVariant === "a") ?? sorted[0]!;
    out.set(num, va.topicRaw);
  }
  return out;
}

function area(dims: string | null): number {
  if (!dims) return 0;
  const m = dims.match(/^(\d+)x(\d+)$/);
  return m ? parseInt(m[1]!, 10) * parseInt(m[2]!, 10) : 0;
}
function pickRep(recs: Rec[]): Rec {
  return [...recs].sort(
    (a, b) => b.version - a.version || area(b.dims) - area(a.dims),
  )[0]!;
}

// One nonDCO MC identity = one card (number+variant / MC0-family), in ≥1 channel.
type Group = {
  key: string;
  number: number | null; // null → auto-assign
  variant: string;
  topicRaw: string;
  byChannel: Map<Channel, Rec[]>;
};

function buildGroups(recs: Rec[], topicOf: Map<number, string>): Group[] {
  const groups = new Map<string, Group>();
  for (const r of recs) {
    const numbered = r.mcNumber != null && r.mcNumber !== 0;
    const gkey = numbered
      ? `n:${r.mcNumber}:${r.mcVariant || "a"}`
      : `f:${r.familyKey}`;
    const topicRaw = numbered ? topicOf.get(r.mcNumber!)! : r.topicRaw;
    const g =
      groups.get(gkey) ??
      ({
        key: gkey,
        number: numbered ? r.mcNumber! : null,
        variant: r.mcVariant || "a",
        topicRaw,
        byChannel: new Map(),
      } satisfies Group);
    const list = g.byChannel.get(r.channel) ?? [];
    list.push(r);
    g.byChannel.set(r.channel, list);
    groups.set(gkey, g);
  }
  return [...groups.values()];
}

async function main() {
  const product = process.argv[2];
  const commit = process.argv.includes("--commit");
  if (!product) {
    console.error("usage: rebuild-creatives.ts <PRODUCT> [--commit]");
    process.exit(1);
  }
  const client = await getActiveClient();
  const clientId = client.id;
  console.log(
    `\n=== rebuild-creatives ${product} (client ${client.key}/${clientId}) ${commit ? "COMMIT" : "DRY-RUN"} ===`,
  );

  const recs = scanProduct(product);
  const topicOf = topicByNumber(recs);
  const groups = buildGroups(recs, topicOf);
  const cellCount = groups.reduce((n, g) => n + g.byChannel.size, 0);
  console.log(`Source files (image+video): ${recs.length}`);
  console.log(
    `  channel split: DISP=${recs.filter((r) => r.channel === "DISP").length} SOC=${recs.filter((r) => r.channel === "SOC").length}`,
  );
  console.log(
    `  MC0/unnumbered files: ${recs.filter((r) => r.mcNumber == null || r.mcNumber === 0).length}`,
  );
  console.log(`Planned: ${groups.length} nonDCO cards → ${cellCount} matrix cells`);

  const psd = await db
    .select({ id: messages.id, number: messages.number, variant: messages.variant })
    .from(messages)
    .innerJoin(
      audiences,
      and(
        eq(audiences.clientId, messages.clientId),
        eq(audiences.key, messages.audience),
      ),
    )
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.template, "Adobe PSD"),
        eq(audiences.product, product),
        sql`${messages.archivedAt} is null`,
      ),
    );
  console.log(`Adobe PSD DCO MCs to delete (product ${product}): ${psd.length}`);

  if (!commit) {
    console.log(`\nDRY-RUN — nothing written.`);
    process.exit(0);
  }

  // ---- COMMIT ----
  const uid = `rebuild:${product}`;

  // 0. idempotent: drop this product's existing nonDCO messages
  const delOld = await db
    .delete(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        like(messages.image1, `ERSTE_${product}_%`),
        inArray(messages.audience, CHANNEL_AUDS),
      ),
    )
    .returning({ id: messages.id });

  // 1. drop this product's creatives + uploaded_files (MinIO bytes kept)
  //    The filename prefix alone is NOT enough: asset-library uploads follow the
  //    same ERSTE_<PROD>_MC… naming, so without the category guard a rebuild also
  //    wipes hand-uploaded assets, leaving the surviving assets rows pointing at
  //    a dead file_id (happened to 3 SZK assets on 2026-08-17).
  const delC = await db
    .delete(creatives)
    .where(and(eq(creatives.clientId, clientId), eq(creatives.product, product)))
    .returning({ id: creatives.id });
  const delF = await db
    .delete(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, clientId),
        eq(uploadedFiles.category, "creative"),
        like(uploadedFiles.filename, `ERSTE_${product}_%`),
      ),
    )
    .returning({ id: uploadedFiles.id });
  console.log(
    `Deleted: ${delOld.length} old nonDCO MCs, ${delC.length} creatives, ${delF.length} uploaded_files`,
  );

  // 2. drop this product's Adobe PSD DCO MCs
  for (const m of psd) {
    await db
      .delete(messages)
      .where(and(eq(messages.clientId, clientId), eq(messages.id, m.id)));
  }
  console.log(`Deleted ${psd.length} Adobe PSD DCO MCs`);

  // 3. reimport files → uploaded_files + creatives
  const fileNameByRec = new Map<Rec, string>();
  const creativeIdByRec = new Map<Rec, number>();
  for (const r of recs) {
    const buffer = fs.readFileSync(r.file);
    const uf = await uploadFile(clientId, {
      buffer,
      originalFilename: r.filename,
      mimeType: MIME[r.ext] ?? "application/octet-stream",
      category: "creative",
      uploadedBy: uid,
      dimensions: r.dims ?? undefined,
    });
    const cr = await createCreative(clientId, {
      fileId: uf.id,
      fileName: uf.filename,
      fileFormat: r.ext,
      fileSize: String(uf.sizeBytes),
      fileDimensions: uf.dimensions ?? r.dims ?? null,
      brand: "ERSTE",
      product: r.product,
      type: r.type,
      visualKeyword: r.topicRaw,
      bannerVersion: String(r.version),
      familyKey: r.familyKey,
    });
    fileNameByRec.set(r, uf.filename);
    creativeIdByRec.set(r, cr.id);
  }
  console.log(`Imported ${recs.length} creatives`);

  // 4. direct-insert nonDCO messages
  const [cfg] = await db
    .select()
    .from(configTable)
    .where(and(eq(configTable.clientId, clientId), eq(configTable.key, "patterns")))
    .limit(1);
  const patterns = cfg ? (JSON.parse(cfg.value) as Record<string, unknown>) : {};
  const audienceList = await db
    .select()
    .from(audiences)
    .where(eq(audiences.clientId, clientId));
  const audByKey = new Map(audienceList.map((a) => [a.key, a]));
  const topByKey = new Map(
    (await db.select().from(topics).where(eq(topics.clientId, clientId))).map(
      (t) => [t.key, t],
    ),
  );
  const [{ maxn }] = await db
    .select({ maxn: sql<number>`coalesce(max(${messages.number}),0)` })
    .from(messages)
    .where(eq(messages.clientId, clientId));
  let autoNum = Number(maxn) + 1;

  async function insertNonDco(
    audienceKey: string,
    topicKey: string,
    number: number,
    variant: string,
    image1: string,
    name: string,
  ) {
    const audienceRow = audByKey.get(audienceKey)!;
    // nonDCO topics are NOT stored in the topics table (they are synthesized in
    // the matrix from the message's topic string), so topicRow is usually null —
    // buildTrafficking tolerates that (topic product just won't feed patterns).
    const topicRow = topByKey.get(topicKey) ?? null;
    const pmmid = generatePmmid(
      { audience: audienceKey, topic: topicKey, number, variant, versionNo: 1 },
      audienceList,
      [],
      (patterns as { pmmid?: string }).pmmid,
    );
    const tr = buildTrafficking(
      { number, variant, audience: audienceKey, topic: topicKey, landingUrl: null },
      audienceRow,
      topicRow,
      patterns,
      audienceList,
      pmmid,
    );
    await db.insert(messages).values({
      clientId,
      number,
      variant,
      audience: audienceKey,
      topic: topicKey,
      versionNo: 1,
      image1,
      name,
      pmmid,
      utmCampaign: tr.utm_campaign,
      utmSource: tr.utm_source,
      utmMedium: tr.utm_medium,
      utmContent: tr.utm_content,
      utmTerm: tr.utm_term,
      utmCd26: tr.utm_cd26,
      finalTraffickedUrl: tr.final_trafficked_url,
    });
  }

  let cards = 0;
  let cells = 0;
  for (const g of groups) {
    // topic = "<PRODUCT>_<keyword>" carried on the message only — no topics-table
    // row is created; the matrix synthesizes nonDCO rows from these strings.
    const topicKey = `${product}_${g.topicRaw}`.slice(0, 200);
    const number = g.number ?? autoNum++;
    for (const [ch, recsInCh] of g.byChannel) {
      const rep = pickRep(recsInCh);
      await insertNonDco(
        AUD[ch],
        topicKey,
        number,
        g.variant,
        fileNameByRec.get(rep)!,
        rep.filename,
      );
      for (const r of recsInCh) {
        const cid = creativeIdByRec.get(r)!;
        const cur = await db
          .select({ v: creatives.version })
          .from(creatives)
          .where(eq(creatives.id, cid))
          .limit(1);
        if (cur[0])
          await updateCreative(clientId, cid, cur[0].v, {
            mcNumber: number,
            mcVariant: g.variant,
          });
      }
      cells++;
    }
    cards++;
  }
  console.log(
    `Created ${cards} nonDCO cards → ${cells} matrix cells\n=== done ${product} ===`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
