// Rebuild the Creative Library for ONE product from the local ground-truth
// folder, then fill the nonDCO matrix with template-less MC mirrors + previews.
//
// Ground truth: ~/ERSTE Addressable AI Agent/creatives/ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<ver>_<WxH>.<ext>
//
// Per-product pipeline (scoped to one product — the sample-first rollout):
//   1. hard-delete the product's `creatives` rows + `uploaded_files` (filename
//      ERSTE_<PROD>_%). MinIO bytes are LEFT intact (extra safety net); the
//      caller has already dumped both tables to a restorable CSV.
//   2. hard-delete the product's Adobe PSD DCO MCs (template='Adobe PSD',
//      audience.product = PROD) — these static creatives move to nonDCO.
//   3. reimport every image/video file: uploadFile (bytes → MinIO + uploaded_files)
//      + createCreative (parsed metadata).
//   4. generate nonDCO MCs, one per (mcNumber, mcVariant) identity:
//      template=null + image1=representative file, at a per-NUMBER topic
//      (= the number's variant-'a' keyword, user-locked). The MC lives in every
//      channel that has a file for it: created in the first channel via
//      createMessage (MC number/variant preserved from the filename; MC0 →
//      auto-assigned), copied into the others via copyMessages (same card, new
//      audience), each channel showing its own size's representative image.
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
import { and, eq, like, sql } from "drizzle-orm";
import { db } from "../src/db";
import { creatives, messages, uploadedFiles, audiences } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import { parseCreativeFilename } from "../src/lib/parse-creative-filename";
import { uploadFile } from "../src/lib/entities/files";
import { createCreative, updateCreative } from "../src/lib/entities/creatives";
import {
  createMessage,
  copyMessages,
  updateMessage,
} from "../src/lib/entities/messages";
import { createTopic } from "../src/lib/entities/topics";

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

// One nonDCO MC identity = one card (number+variant / MC0-family), living in
// one or more channels.
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
  console.log(`Source files (image+video): ${recs.length}`);
  console.log(
    `  channel split: DISP=${recs.filter((r) => r.channel === "DISP").length} SOC=${recs.filter((r) => r.channel === "SOC").length}`,
  );
  console.log(
    `  MC0/unnumbered files (auto-assign): ${recs.filter((r) => r.mcNumber == null || r.mcNumber === 0).length}`,
  );
  const cellCount = groups.reduce((n, g) => n + g.byChannel.size, 0);
  console.log(
    `Planned: ${groups.length} nonDCO cards → ${cellCount} matrix cells (card × channel)`,
  );

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
  console.log(
    `Adobe PSD DCO MCs to delete (product ${product}): ${psd.length} — [${psd
      .map((m) => m.number + m.variant)
      .join(", ")}]`,
  );

  if (!commit) {
    console.log(`\nDRY-RUN — nothing written. Sample cards:`);
    for (const g of groups.slice(0, 10)) {
      const chans = [...g.byChannel.keys()].join("+");
      console.log(
        `  MC${g.number ?? "auto"}${g.variant} [${chans}] topic="${g.topicRaw}" (${[...g.byChannel.values()].reduce((n, l) => n + l.length, 0)} files)`,
      );
    }
    process.exit(0);
  }

  // ---- COMMIT ----
  const uid = `rebuild:${product}`;

  const delC = await db
    .delete(creatives)
    .where(and(eq(creatives.clientId, clientId), eq(creatives.product, product)))
    .returning({ id: creatives.id });
  const delF = await db
    .delete(uploadedFiles)
    .where(
      and(
        eq(uploadedFiles.clientId, clientId),
        like(uploadedFiles.filename, `ERSTE_${product}_%`),
      ),
    )
    .returning({ id: uploadedFiles.id });
  console.log(`Deleted: ${delC.length} creatives, ${delF.length} uploaded_files`);

  for (const m of psd) {
    await db
      .delete(messages)
      .where(and(eq(messages.clientId, clientId), eq(messages.id, m.id)));
  }
  console.log(`Deleted ${psd.length} Adobe PSD DCO MCs`);

  // reimport → uploaded_files + creatives
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

  // generate nonDCO MCs
  const topicDone = new Set<string>();
  let cards = 0;
  let cells = 0;
  for (const g of groups) {
    const topicKey = `${product}_${g.topicRaw}`.slice(0, 200);
    if (!topicDone.has(topicKey)) {
      try {
        await createTopic(clientId, { key: topicKey, name: g.topicRaw, product });
      } catch {
        /* topic already exists — createTopic throws on dup key */
      }
      topicDone.add(topicKey);
    }

    const chans = [...g.byChannel.keys()];
    const primary = chans[0]!;
    const repP = pickRep(g.byChannel.get(primary)!);
    const input = {
      audience: AUD[primary],
      topic: topicKey,
      image1: fileNameByRec.get(repP)!,
      name: repP.filename,
    };
    // Prefer the filename's MC number/variant. If it collides with a live
    // message in another topic (the "a number never spans topics" invariant),
    // fall back to an auto-assigned number — the creative keeps its filename
    // label in the creatives row; only the matrix MC number differs.
    let msg;
    if (g.number != null) {
      try {
        msg = await createMessage(clientId, input, {
          requestedNumber: g.number,
          requestedVariant: g.variant,
        });
      } catch (e) {
        console.log(
          `  ⚠ MC${g.number}${g.variant} could not claim filename number (${(e as Error).message.slice(0, 70)}) → auto-number`,
        );
        msg = await createMessage(clientId, input, {});
      }
    } else {
      msg = await createMessage(clientId, input, {});
    }
    cells++;

    for (const ch of chans.slice(1)) {
      const { created } = await copyMessages(
        clientId,
        [msg.pmmid!],
        [AUD[ch]],
      );
      const copy = created[0]!;
      const repC = pickRep(g.byChannel.get(ch)!);
      await updateMessage(clientId, copy.id, copy.version, {
        image1: fileNameByRec.get(repC)!,
        name: repC.filename,
      });
      cells++;
    }

    // back-link every creative in the card to its MC cell
    for (const list of g.byChannel.values()) {
      for (const r of list) {
        const cid = creativeIdByRec.get(r)!;
        const cur = await db
          .select({ v: creatives.version })
          .from(creatives)
          .where(eq(creatives.id, cid))
          .limit(1);
        if (cur[0])
          await updateCreative(clientId, cid, cur[0].v, {
            mcNumber: msg.number,
            mcVariant: msg.variant,
          });
      }
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
