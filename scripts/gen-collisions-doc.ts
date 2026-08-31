// Build docs/mc-collisions.html — every MC number used on BOTH numbering axes
// (a DCO campaign card AND a nonDCO static creative), with the DCO banner
// rendered through the app's own template pipeline, the static creative beside
// it, and a written reading of what kind of collision it is.
//
// Read-only over the live DB; safe to re-run as collisions get resolved. The
// per-number prose in NOTES is hand-written from the evidence — revisit it when
// the underlying data changes.
//
// Needs the dev server up (the shooter loads /api/templates/... on the app origin):
//   npm run dev
//   npx tsx scripts/gen-collisions-doc.ts

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { clients, creatives, messages, channels, uploadedFiles } from "../src/db/schema";
import { shootItems } from "../src/lib/preview-shooter";
import { readFileBytes } from "../src/lib/storage";

const SIZE = "300x250";
// Cap the cross-reference lists so a card stays readable.
const MAX_HITS = 6;
const TMP = path.join(os.tmpdir(), "mm6-collisions");
const OUT = path.resolve(process.cwd(), "docs/mc-collisions.html");

type Row = typeof messages.$inferSelect;

type Group = {
  variant: string;
  topic: string;
  rows: number;
  statuses: string[];
  headline?: string | null;
  classes?: string | null;
  image1?: string | null;
  file?: string | null;
};
type Item = {
  number: number;
  dco: Group[];
  non: Group[];
  dcoRepVariant: string;
  nonRepVariant: string;
  nonImg: string | null;
  dcoImg: string | null;
};

type Kind = "twin" | "clash" | "dup";

const KIND_LABEL: Record<Kind, string> = {
  twin: "Szándékos ikerpár",
  clash: "Valódi ütközés",
  dup: "nonDCO duplikáció",
};

// Per-number reading of the collision. Written from the side-by-side creatives
// plus the topic/filename evidence — not derived by a rule, because the same
// shared number means something different in each of the three cases.
const NOTES: Record<number, { kinds: Kind[]; html: string }> = {
  78: {
    kinds: ["twin"],
    html: `<b>Frissen megteremtett, szándékos ikerpár.</b> A statikus <code>VAL_Tarsashaz_szamla_pro_b</code> (b variáns, 4 méret) régóta megvolt, a DCO párja viszont soha nem készült el — a Társasház kártya tévedésből <b>MC5</b>-öt kapott, ahol a HITEL Babaváró statikussal ütközött. 2026-08-30-án átírtuk MC78-ra, így a DCO kártya és a statikus kreatív végre egy számon van. Statikus ikre csak a <b>b</b> variánsnak van; az a és c csak a DCO oldalon él.`,
  },
  124: {
    kinds: ["twin"],
    html: `Ugyanaz a kreatív két formában. A DCO 124b háttere <code>06_kadarkocka_shutterstock_2279201781.jpg</code>, a statikus fájlneve <code>ERSTE_SZK_MC124_b_<b>kadarkocka</b>_creative_asset_n5</code> — ugyanaz a „kádarkocka" vizuál. A nonDCO téma (<code>SZK_creative_asset</code>) egy gyűjtő-téma, nem külön kampány.`,
  },
  131: {
    kinds: ["twin"],
    html: `A DCO téma <code>SZK_edukacio_NA_NA_<b>endtoend</b>_igenyles</code>, a statikusé <code>ERSTE_SZK_MC131_f_<b>endtoend</b>_creative_asset</code> — ugyanaz az „end-to-end igénylés" kampány. Az f és g variáns mindkét oldalon megvan, a c–e csak DCO-n.`,
  },
  134: {
    kinds: ["twin"],
    html: `DCO: <code>SZK_felhaszcelja_NA_<b>hitelkivaltas</b></code>, statikus: <code>SZK_<b>hitelkivalto</b>_creative_asset</code>. Ugyanaz a hitelkiváltás kampány, a statikus a social/display kivágata. A DCO oldal 40 sor (30 + 10 audience), a statikus 1 fájl.`,
  },
  141: {
    kinds: ["twin"],
    html: `DCO: <code>SZK_promocio_NA_NA_<b>kamatkedvezmeny</b></code>, statikus: <code>SZK_<b>kedvezobb_kamatert</b>_persely</code> — ugyanaz a kamatkedvezmény-promóció, a statikus a „persely" vizuállal. Csak a c variáns közös; az a, b, d csak DCO-n él.`,
  },
  290: {
    kinds: ["twin", "dup"],
    html: `A DCO <i>Hiteltinder / hitelválasztó kérdőív</i> kártya és a statikus ugyanaz a kampány — eddig szabályos ikerpár. <b>De a nonDCO oldalon kétszer szerepel ugyanaz a kreatív</b>, két külön téma alatt: <code>HITEL_kerdoiv_hitelvalaszto_hiteltinder_1</code> és <code>SZK_HITEL_a_kerdoiv_NA_hitelvalaszto_hiteltinder_1_a</code>. Ez már nem tengelyek közti ütközés, hanem <b>kétszeres import</b> — az egyik példány fölösleges.`,
  },
  294: {
    kinds: ["twin"],
    html: `DCO: <code>VAL_brand_bankvaltas_NA_rem120e</code>, statikus: <code>VAL_Remarketing_Erstes-leszek_120e_rem</code>. Ugyanaz a 120e-s vállalkozói remarketing kampány, csak a téma-elnevezés más generációból való. Ez az a kártya, amit korábban külön kézzel helyeztünk el (MC337a → MC294a).`,
  },
  301: {
    kinds: ["twin"],
    html: `DCO: <code>SZK_felhaszcelja_elorejutas_beerste_<b>bankvaltas</b>Adossagrendezes</code>, statikus: <code>SZK_<b>bankvaltas</b>_hitelkivaltas</code>. Ugyanaz a bankváltás/adósságrendezés kampány. A statikus oldalon négy variáns (a–d) van, a DCO-n kettő (b, c) — a számozás tehát a variáns szintjén sem fedi egymást.`,
  },
  302: {
    kinds: ["twin", "clash"],
    html: `<b>Megvizsgálva és elfogadva — nem javítjuk.</b> Az egyik nonDCO téma (<code>SZK_bankvalats_hitel</code>) a DCO bankváltás-kártya szabályos statikus ikre; a másik (<code>SZA_onlineszamla_2026Q1_fullImageSurface</code>, 5 variáns) más product más kampánya. Az azonos szám <b>az átálláskor keletkezett</b>, és két külön productban fut — a DCO oldal ráadásul már <code>INACTIVE</code>.<br><br>Átírni amúgy sem lehetne: a <b>v0 SZK feed 2026-05-03-án felment Adformra</b> a DCO 302 pmmid-jével, és <b>529 monitoring sor</b> hivatkozik rá (a másik 11 az <code>onlineszamla_q2</code> témára). Mindkét oldal mind a 107 sorának <code>comment</code> mezőjébe bekerült a magyarázat.`,
  },
  311: {
    kinds: ["twin"],
    html: `DCO: <code>SZA_brand_Cseperedo_<b>VISA</b></code>, statikus: <code>SZA_Cseperedo-2026Q2_ERSTE-<b>VISA</b>-cseperedo_VISA</code>. Ugyanaz a Cseperedő + Visa kampány. A b variáns közös, az a csak statikusban van meg.`,
  },
  316: {
    kinds: ["twin"],
    html: `A legszorosabb kötés a listán: a DCO kártya háttere maga a statikus kreatív precompja — <code>precomp_ERSTE_MC316_a_calculator_mockup_auto_n7.png</code>, <code>preCompBg</code> osztállyal. A DCO banner tehát szó szerint a statikusból épül. A közös szám itt nem hiba, hanem a felépítés következménye.`,
  },
  317: {
    kinds: ["twin"],
    html: `Ugyanaz a kalkulátor-mockup séma, mint a 316-nál: a DCO háttér <code>precomp_ERSTE_MC317_b_calculator_mockup_lakasfelujitas_n7.png</code>, a statikus ugyanennek a forrása. Lakásfelújítás felhasználási cél.`,
  },
  318: {
    kinds: ["twin"],
    html: `Kalkulátor-mockup, hitelkiváltás. DCO háttér: <code>precomp_ERSTE_MC318_c_calculator_mockup_hitelkivaltas_n8.png</code>. A statikus oldalon két variáns (b és c) van, a DCO-n csak a c.`,
  },
  319: {
    kinds: ["twin"],
    html: `Kalkulátor-mockup, váratlan kiadások. DCO háttér: <code>precomp_ERSTE_MC319_d_calculator_mockup_varatlan_n7.png</code>. A d variáns mindkét oldalon ugyanaz.`,
  },
  320: {
    kinds: ["twin"],
    html: `Kalkulátor-mockup, szabad felhasználás. DCO háttér: <code>precomp_ERSTE_MC320_e_calculator_mockup_szabad_n7.png</code>. Statikusban b és e variáns is van, DCO-n csak az e.`,
  },
  321: {
    kinds: ["twin", "dup"],
    html: `A DCO <code>SZK_brand_NA_NA_TCU</code> és a statikus TCU kampány ikerpár. <b>De a 290-hez hasonlóan itt is kétszer szerepel ugyanaz a statikus</b>, két téma alatt: <code>HITEL_TCU_2026Q2_fullColorSurface</code> és <code>SZK_HITEL_a_TCU_2026Q2_fullColorSurface</code>. Ugyanaz a kétszeres-import minta — érdemes egyszerre rendezni a 290-nel.`,
  },
  330: {
    kinds: ["twin"],
    html: `DCO: <code>SZK_felhaszcelja_elorejutas_lakas_<b>felujitas</b></code>, statikus: <code>SZK_<b>felhasznalas_lakasfelujitas</b></code>. Ugyanaz a kampány; a DCO háttérképek fájlneve is <code>MC330_a/b/c_felhasznalas_lakasfelujitas_n1.jpg</code>, vagyis a statikusból származnak. A DCO-n hat variáns van (a–f), ahol d/e/f ugyanazt a három vizuált ismétli.`,
  },
  331: {
    kinds: ["twin"],
    html: `Ugyanaz a séma, mint a 330-nál, kert/terasz felhasználási céllal: <code>SZK_felhaszcelja_elorejutas_lakas_<b>kert</b></code> ↔ <code>SZK_<b>felhasznalas_kert</b></code>. Mindhárom variáns (a, b, c) mindkét oldalon megvan.`,
  },
  332: {
    kinds: ["twin"],
    html: `DCO: <code>SZK_emlkezteto_NA_NA_almaidCeljaidTerveid15M</code>, statikus: <code>SZK_<b>remarketing</b></code>. Ugyanaz a remarketing kampány, a DCO háttérképek (<code>ERSTE_SZK_MC332_a/b_remarketing_n1.jpg</code>) a statikus forrásai. Mindhárom variáns megvan mindkét oldalon.`,
  },
};

function dataUri(file: string | null): string | null {
  if (!file || !fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function groupList(gs: Group[], kind: "dco" | "non"): string {
  return gs
    .map((g) => {
      const bits = [
        `<span class="variant-chip">${esc(g.variant)}</span>`,
        `<code class="topic">${esc(g.topic)}</code>`,
      ].join(" ");
      const meta = [
        `${g.rows} sor`,
        ...g.statuses.filter((s) => s !== "—").map((s) => `<span class="status-badge status-badge--${s.toLowerCase()}">${esc(s)}</span>`),
      ].join(" · ");
      const extra =
        kind === "dco"
          ? [g.headline ? `„${esc(g.headline)}"` : "", g.classes ? `<code class="cls">${esc(g.classes)}</code>` : ""]
              .filter(Boolean)
              .join("<br>")
          : g.file
            ? `<code class="fname">${esc(g.file)}</code>`
            : "";
      return `<li class="axis-row">${bits}<div class="axis-row__meta">${meta}</div>${extra ? `<div class="axis-row__extra">${extra}</div>` : ""}</li>`;
    })
    .join("");
}

async function collectData(): Promise<Item[]> {

  fs.mkdirSync(TMP, { recursive: true });
  const [client] = await db.select().from(clients).where(eq(clients.key, "erste"));
  const clientId = client.id;

  const chans = await db.select().from(channels).where(eq(channels.clientId, clientId));
  const chanKeys = new Set(chans.map((c) => c.key));
  const all = await db.select().from(messages).where(eq(messages.clientId, clientId));

  const axisOf = (m: Row) => (chanKeys.has(m.audience) ? "nonDCO" : "DCO");

  const byNumber = new Map<number, { DCO: Row[]; nonDCO: Row[] }>();
  for (const m of all) {
    const e = byNumber.get(m.number) ?? { DCO: [], nonDCO: [] };
    e[axisOf(m) as "DCO" | "nonDCO"].push(m);
    byNumber.set(m.number, e);
  }
  const numbers = [...byNumber.entries()]
    .filter(([, e]) => e.DCO.length > 0 && e.nonDCO.length > 0)
    .map(([n]) => n)
    .sort((a, b) => a - b);

  const group = (rows: Row[]): Group[] => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.variant}||${r.topic}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()]
      .map((rs) => ({
        variant: rs[0].variant,
        topic: rs[0].topic,
        rows: rs.length,
        rep: rs[0],
        statuses: [...new Set(rs.map((r) => r.status || "—"))],
      }))
      .sort((a, b) => a.variant.localeCompare(b.variant) || a.topic.localeCompare(b.topic));
  };

  // Files, for resolving the nonDCO creative image bytes.
  const files = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.clientId, clientId));
  const fileByName = new Map(files.map((f) => [f.filename, f]));

  const out: Record<string, unknown>[] = [];
  const shots: { key: string; row: Row }[] = [];

  for (const number of numbers) {
    const e = byNumber.get(number)!;
    const dco = group(e.DCO);
    const non = group(e.nonDCO);
    // Prefer a DCO variant that also exists on the nonDCO side, so the two
    // columns show the same creative slot rather than two unrelated variants.
    const shared = dco.find((d) => non.some((n) => n.variant === d.variant));
    const dcoRep = shared ?? dco[0];
    const nonRep = non.find((n) => n.variant === dcoRep.variant) ?? non[0];

    if (dcoRep.rep.template) {
      shots.push({ key: `dco-${number}`, row: dcoRep.rep });
    }

    // nonDCO creative bytes: prefer a square, else the first file we can find.
    const candidates = non
      .flatMap((g) => e.nonDCO.filter((r) => r.variant === g.variant && r.topic === g.topic))
      .map((r) => r.image1 || r.name || "")
      .filter(Boolean);
    const pick =
      candidates.find((c) => c.includes("1080x1080")) ??
      candidates.find((c) => c.includes("970x250")) ??
      candidates[0];
    let nonImg: string | null = null;
    const f = pick ? fileByName.get(pick) : undefined;
    if (f) {
      try {
        const buf = await readFileBytes(f.storagePath);
        const raw = path.join(TMP, `non-${number}-raw${path.extname(f.filename) || ".png"}`);
        const small = path.join(TMP, `non-${number}.jpg`);
        fs.writeFileSync(raw, buf);
        execFileSync("sips", ["-Z", "440", "-s", "format", "jpeg", "-s", "formatOptions", "72", raw, "--out", small], { stdio: "ignore" });
        nonImg = small;
      } catch (err) {
        console.error(`  ! ${number} nonDCO image: ${(err as Error).message}`);
      }
    }

    out.push({
      number,
      dco: dco.map((g) => ({ variant: g.variant, topic: g.topic, rows: g.rows, statuses: g.statuses, headline: g.rep.headline, classes: g.rep.templateVariantClasses, image1: g.rep.image1 })),
      non: non.map((g) => ({ variant: g.variant, topic: g.topic, rows: g.rows, statuses: g.statuses, file: g.rep.image1 || g.rep.name })),
      dcoRepVariant: dcoRep.variant,
      dcoRepTopic: dcoRep.topic,
      nonRepVariant: nonRep.variant,
      nonRepTopic: nonRep.topic,
      nonImg,
      dcoImg: dcoRep.rep.template ? path.join(TMP, `dco-${number}.png`) : null,
      dcoTemplate: dcoRep.rep.template,
    });
  }

  console.log(`collisions: ${numbers.length}, banners to shoot: ${shots.length}`);

  const results = await shootItems(
    clientId,
    shots.map((s) => ({
      template: s.row.template!,
      row: s.row as unknown as Record<string, unknown>,
      size: SIZE,
      persist: async (buf: Buffer) => {
        fs.writeFileSync(path.join(TMP, `${s.key}.png`), buf);
        return { id: 0, updatedAt: "" };
      },
    })),
    {
      baseUrl: "http://localhost:6001",
      onShot: (r, i) =>
        console.log(`  ${r.ok ? "✓" : "✗"} ${shots[i].key}${r.ok ? "" : " " + r.error}`),
    },
  );
  const failed = results.filter((r) => !r.ok).length;
  console.log(`shot ${results.length - failed}, failed ${failed}`);

  return out as unknown as Item[];
}

// A SECOND kind of overlap, below the axis level: inside `creatives`, one
// (mc_number, mc_variant) can carry files from two unrelated campaigns, because
// the filename convention encodes the campaign but nothing enforces that one MC
// number means one campaign. Derived from the filenames, not from any join.
type OverlapCampaign = { name: string; files: number; fileId: string | null; products: string[] };
type Overlap = { mcNumber: number; mcVariant: string; campaigns: OverlapCampaign[]; files: number };

async function creativeOverlaps(clientId: number): Promise<Overlap[]> {
  const rows = await db
    .select({
      mcNumber: creatives.mcNumber,
      mcVariant: creatives.mcVariant,
      fileName: creatives.fileName,
      fileId: creatives.fileId,
    })
    .from(creatives)
    .where(eq(creatives.clientId, clientId));
  const byKey = new Map<
    string,
    {
      mcNumber: number;
      mcVariant: string;
      camps: Map<string, { files: number; fileId: string | null; products: Set<string> }>;
    }
  >();
  for (const r of rows) {
    if (r.mcNumber == null || !r.fileName) continue;
    // ERSTE_<PRODUCT>_MC<n>_<variant>_<campaign>_n<k>_<W>x<H>.<ext>
    const m = r.fileName.match(/^ERSTE_([A-Z]+)_MC\d+_[a-z]_(.+)_n\d+_\d+x\d+\.[a-z]+$/i);
    if (!m) continue;
    const key = `${r.mcNumber}|${r.mcVariant ?? ""}`;
    const e =
      byKey.get(key) ??
      { mcNumber: r.mcNumber, mcVariant: r.mcVariant ?? "", camps: new Map() };
    const prev = e.camps.get(m[2]);
    // Prefer a square as the thumbnail — it reads best at card size.
    const better =
      !prev?.fileId || (/1080x1080/.test(r.fileName) && r.fileId);
    e.camps.set(m[2], {
      files: (prev?.files ?? 0) + 1,
      fileId: better ? (r.fileId ?? prev?.fileId ?? null) : prev.fileId,
      products: (prev?.products ?? new Set<string>()).add(m[1].toUpperCase()),
    });
    byKey.set(key, e);
  }
  // Two campaign strings on one MC are only a real overlap when they are
  // genuinely different campaigns. Naming variance inside ONE campaign is
  // common (…_badge, …-promo-2, …_fullImageSurface vs …_colorAndImage), so
  // treat as related when one token set contains the other, or when they share
  // a first token. Only a pair that is related by neither is reported.
  // Rendition markers, not campaign identity — "kadarkocka_creative_asset" and
  // "kadarkocka_image-only" are one campaign in two renditions.
  const RENDITION = new Set(["creative", "asset", "image", "only"]);
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[_\-]+/)
        .filter((t) => t && !RENDITION.has(t)),
    );
  const related = (a: string, b: string) => {
    const ta = tokens(a);
    const tb = tokens(b);
    if ([...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t))) return true;
    return [...ta][0] === [...tb][0];
  };
  const hasUnrelatedPair = (camps: string[]) =>
    camps.some((a, i) => camps.slice(i + 1).some((b) => !related(a, b)));

  return [...byKey.values()]
    .filter((e) => e.camps.size > 1 && hasUnrelatedPair([...e.camps.keys()]))
    .map((e) => ({
      mcNumber: e.mcNumber,
      mcVariant: e.mcVariant,
      campaigns: [...e.camps.entries()]
        .map(([name, v]) => ({
          name,
          files: v.files,
          fileId: v.fileId,
          products: [...v.products].sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      files: [...e.camps.values()].reduce((a, b) => a + b.files, 0),
    }))
    .sort((a, b) => a.mcNumber - b.mcNumber);
}

// Pull one creative per campaign out of the object store and inline it, so the
// overlap section shows WHAT collided, not just the filename strings.
async function overlapThumbs(
  clientId: number,
  overlaps: Overlap[],
): Promise<Map<string, { uri: string; raw: string }>> {
  const ids = [...new Set(overlaps.flatMap((o) => o.campaigns.map((c) => c.fileId)).filter(Boolean))] as string[];
  const out = new Map<string, { uri: string; raw: string }>();
  if (ids.length === 0) return out;
  const files = await db
    .select({ id: uploadedFiles.id, path: uploadedFiles.storagePath, name: uploadedFiles.filename })
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.clientId, clientId), inArray(uploadedFiles.id, ids)));
  for (const f of files) {
    try {
      const buf = await readFileBytes(f.path);
      const raw = path.join(TMP, `ov-${f.id}-raw${path.extname(f.name) || ".png"}`);
      const small = path.join(TMP, `ov-${f.id}.jpg`);
      fs.writeFileSync(raw, buf);
      execFileSync(
        "sips",
        ["-Z", "260", "-s", "format", "jpeg", "-s", "formatOptions", "60", raw, "--out", small],
        { stdio: "ignore" },
      );
      const uri = dataUri(small);
      if (uri) out.set(f.id, { uri, raw });
    } catch {
      // A missing object just means no thumbnail for that campaign.
    }
  }
  return out;
}

// The static creatives carry their copy as pixels, so the only way to ask "does
// any DCO card say this?" is to read the image. Vision's text recogniser ships
// with macOS — same platform assumption `sips` already makes above.
const OCR_SWIFT = `import Foundation
import Vision
import AppKit

for p in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: p),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("\\(p)\\t"); continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["hu-HU", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    print("\\(p)\\t\\(lines.joined(separator: " | "))")
}
`;

function ocrBinary(): string | null {
  const bin = path.join(TMP, "ocr");
  if (fs.existsSync(bin)) return bin;
  try {
    const src = path.join(TMP, "ocr.swift");
    fs.writeFileSync(src, OCR_SWIFT);
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "ignore" });
    return bin;
  } catch {
    return null;
  }
}

/** path → recognised text, one call for the whole batch. */
function ocrAll(files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const bin = ocrBinary();
  if (!bin || files.length === 0) return out;
  // Chunked so the argv stays sane on big runs.
  for (let i = 0; i < files.length; i += 40) {
    const chunk = files.slice(i, i + 40);
    try {
      const res = execFileSync(bin, chunk, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      for (const line of res.split("\n")) {
        const tab = line.indexOf("\t");
        if (tab > 0) out.set(line.slice(0, tab), line.slice(tab + 1));
      }
    } catch {
      // OCR is an enrichment; a failed chunk just means no text matches.
    }
  }
  return out;
}

// Accent-insensitive, punctuation-free — the recogniser drops diacritics often
// enough ("almaid" for "álmaid") that comparing raw strings would miss.
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type DcoCard = { number: number; variant: string; topic: string; status: string | null; headline: string };

async function dcoCards(clientId: number): Promise<DcoCard[]> {
  const chans = await db.select().from(channels).where(eq(channels.clientId, clientId));
  const chanKeys = new Set(chans.map((c) => c.key));
  const rows = await db
    .select({
      number: messages.number,
      variant: messages.variant,
      topic: messages.topic,
      status: messages.status,
      headline: messages.headline,
      audience: messages.audience,
    })
    .from(messages)
    .where(eq(messages.clientId, clientId));
  const seen = new Set<string>();
  const out: DcoCard[] = [];
  for (const r of rows) {
    if (chanKeys.has(r.audience)) continue;
    // A headline only identifies a card if it is long and specific enough.
    // "Személyi Kölcsön" is printed on half the SZK creatives — matching on it
    // would return the whole product line instead of a reference.
    const n = norm(r.headline ?? "");
    if (n.length < 20 || n.split(" ").length < 4) continue;
    const k = `${r.number}|${r.variant}|${r.headline}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ number: r.number, variant: r.variant, topic: r.topic, status: r.status, headline: r.headline });
  }
  return out;
}

async function main() {
  const items = await collectData();
  const [client] = await db.select().from(clients).where(eq(clients.key, "erste"));
  const clientId = client.id;
  const overlaps = await creativeOverlaps(clientId);


  const counts = { twin: 0, clash: 0, dup: 0 };
  for (const it of items) for (const k of NOTES[it.number]?.kinds ?? []) counts[k]++;

  const thumbs = await overlapThumbs(clientId, overlaps);

  // Cross-reference each overlapping campaign against the DCO side, two ways:
  // by MC number, and by the copy actually printed on the static creative.
  const cards = await dcoCards(clientId);
  const ocrText = ocrAll([...thumbs.values()].map((t) => t.raw));
  const dcoByNumber = new Map<number, DcoCard[]>();
  for (const c of cards) dcoByNumber.set(c.number, [...(dcoByNumber.get(c.number) ?? []), c]);

  const textMatches = (fileId: string | null): DcoCard[] => {
    if (!fileId) return [];
    const t = thumbs.get(fileId);
    const raw = t ? ocrText.get(t.raw) : undefined;
    if (!raw) return [];
    const hay = norm(raw);
    const hit = cards.filter((c) => hay.includes(norm(c.headline)));
    // One entry per (number, variant) — the same headline repeats per audience.
    const seen = new Set<string>();
    return hit.filter((c) => {
      const k = `${c.number}${c.variant}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const refBlock = (o: Overlap) => {
    const byNum = dcoByNumber.get(o.mcNumber) ?? [];
    const seenNum = new Set<string>();
    const byNumUniq = byNum.filter((c) => {
      const k = `${c.number}${c.variant}`;
      if (seenNum.has(k)) return false;
      seenNum.add(k);
      return true;
    });
    const byText = o.campaigns.flatMap((c) => textMatches(c.fileId));
    const seenTxt = new Set<string>();
    const byTextUniq = byText.filter((c) => {
      const k = `${c.number}${c.variant}`;
      if (seenTxt.has(k)) return false;
      seenTxt.add(k);
      return true;
    });
    const cardLine = (c: DcoCard) =>
      `<div class="ov-ref__hit"><span class="mc-label">MC${c.number}${esc(c.variant)}</span>${
        c.status ? `<span class="status-badge status-badge--${c.status.toLowerCase()}">${esc(c.status)}</span>` : ""
      }<code class="topic">${esc(c.topic)}</code><span class="ov-ref__hl">„${esc(c.headline)}"</span></div>`;
    return `<aside class="ov-ref">
      <div class="ov-ref__block">
        <div class="ov-ref__k">MC${o.mcNumber} a DCO oldalon</div>
        ${byNumUniq.length ? byNumUniq.slice(0, MAX_HITS).map(cardLine).join("") + (byNumUniq.length > MAX_HITS ? `<div class="ov-ref__none">+${byNumUniq.length - MAX_HITS} további</div>` : "") : `<div class="ov-ref__none">nincs DCO kártya ezen a számon</div>`}
      </div>
      <div class="ov-ref__block">
        <div class="ov-ref__k">a képen olvasott szöveg alapján</div>
        ${byTextUniq.length ? byTextUniq.slice(0, MAX_HITS).map(cardLine).join("") + (byTextUniq.length > MAX_HITS ? `<div class="ov-ref__none">+${byTextUniq.length - MAX_HITS} további</div>` : "") : `<div class="ov-ref__none">nincs egyező DCO headline</div>`}
      </div>
    </aside>`;
  };

  const overlapCards = overlaps
    .map(
      (o) => `<div class="ov-card">
        <div class="ov-card__head">
          <span class="mc-label">MC${o.mcNumber}</span><span class="variant-chip">${esc(o.mcVariant)}</span>
          <span class="ov-n">${o.files} fájl</span>
        </div>
        <div class="ov-card__body">
          <div class="ov-card__camps">
            ${o.campaigns
              .map((c) => {
                const src = c.fileId ? thumbs.get(c.fileId)?.uri : null;
                return `<figure class="ov-camp">
                  ${src ? `<img src="${src}" alt="${esc(c.name)}">` : `<div class="empty-state">nincs kép</div>`}
                  <figcaption>
                    <code>${esc(c.name)}</code>
                    <span class="ov-camp__meta">
                      <span class="product-tags">${c.products
                        .map((pr) => `<span class="product-tag product-tag--${pr.toLowerCase()}">${esc(pr)}</span>`)
                        .join("")}</span>
                      <span class="ov-n">${c.files} fájl</span>
                    </span>
                  </figcaption>
                </figure>`;
              })
              .join("")}
          </div>
          ${refBlock(o)}
        </div>
      </div>`,
    )
    .join("");

  const rowFor = (it: Item) => {
      const note = NOTES[it.number] ?? { kinds: [], html: "" };
      const dcoSrc = dataUri(it.dcoImg);
      const nonSrc = dataUri(it.nonImg);
      const badges = note.kinds
        .map((k) => `<span class="kind-badge kind-badge--${k}">${KIND_LABEL[k]}</span>`)
        .join(" ");
      return `
      <tr id="mc${it.number}">
        <td class="cell cell--dco">
          <div class="cell__head"><span class="mc-label">MC${it.number}</span><span class="axis-tag axis-tag--dco">DCO</span></div>
          ${dcoSrc ? `<img class="banner" src="${dcoSrc}" alt="MC${it.number}${it.dcoRepVariant} DCO banner" width="300" height="250">` : `<div class="empty-state">nincs renderelhető sablon</div>`}
          <div class="cell__caption">renderelt banner — ${esc(it.dcoRepVariant)} variáns, 300×250</div>
          <ul class="axis-list">${groupList(it.dco, "dco")}</ul>
        </td>
        <td class="cell cell--non">
          <div class="cell__head"><span class="mc-label">MC${it.number}</span><span class="axis-tag axis-tag--non">nonDCO</span></div>
          ${nonSrc ? `<img class="static-creative" src="${nonSrc}" alt="MC${it.number}${it.nonRepVariant} statikus kreatív">` : `<div class="empty-state">nincs kép</div>`}
          <div class="cell__caption">statikus kreatív — ${esc(it.nonRepVariant)} variáns</div>
          <ul class="axis-list">${groupList(it.non, "non")}</ul>
        </td>
        <td class="cell cell--note">
          <div class="kind-badges">${badges}</div>
          <p class="note">${note.html}</p>
        </td>
      </tr>`;
  };

  const KIND_INTRO: Record<Kind, string> = {
    twin: "Ugyanaz a kampány két formában — a DCO kártya és a hozzá tartozó statikus kivágat. A közös szám itt <b>helyes</b>: a tengelyenkénti számozás pontosan ezt engedi meg. Nincs teendő.",
    clash: "Két <b>nem összetartozó</b> kampány ül egy számon. Itt a szám többé nem azonosít semmit, és a riportban két különböző dolog folyik össze. Ez az, amit javítani kell.",
    dup: "Ugyanaz a statikus kreatív <b>kétszer importálva</b>, két külön téma alatt. Ez nem tengelyek közti ütközés — az egyik példány fölösleges.",
  };

  const panelFor = (kind: Kind) => {
    const sel = items.filter((it) => (NOTES[it.number]?.kinds ?? []).includes(kind));
    if (sel.length === 0) return `<p class="note">Nincs ilyen eset.</p>`;
    return `<div class="intro"><p>${KIND_INTRO[kind]}</p></div>
    <table>
      <thead><tr><th>DCO kampány-kártya</th><th>nonDCO statikus kreatív</th><th>Az ütközés természete</th></tr></thead>
      <tbody>${sel.map(rowFor).join("")}</tbody>
    </table>`;
  };

  const TABS: { id: string; label: string; n: number }[] = [
    { id: "twin", label: KIND_LABEL.twin, n: counts.twin },
    { id: "clash", label: KIND_LABEL.clash, n: counts.clash },
    { id: "dup", label: KIND_LABEL.dup, n: counts.dup },
    { id: "overlap", label: "Creative-átfedés", n: overlaps.length },
  ];
  const tabsHtml = `<div class="tab-bar" role="tablist">${TABS.map(
    (t, i) =>
      `<button class="tab${i === 0 ? " tab--active" : ""}" role="tab" data-tab="${t.id}">${t.label}<span class="tab__n">${t.n}</span></button>`,
  ).join("")}</div>`;

  const panelsHtml = TABS.map(
    (t, i) => `<section class="panel" data-panel="${t.id}"${i === 0 ? "" : " hidden"}>${
      t.id === "overlap"
        ? `<div class="intro">
            <p>Ez <b>nem</b> tengely-ütközés. A <code>creatives</code> táblában egy <code>(mc_number, mc_variant)</code> páron <b>két különböző kampány fájljai</b> ülnek. A fájlnév-konvenció (<code>ERSTE_&lt;PRODUCT&gt;_MC&lt;n&gt;_&lt;variáns&gt;_&lt;kampány&gt;_n&lt;k&gt;_&lt;méret&gt;</code>) kódolja a kampányt, de semmi nem kényszeríti ki, hogy egy MC-szám egy kampányt jelentsen — így a Drive külön mappáiból ugyanarra a számra érkeztek fájlok.</p>
            <p><b>Miért számít:</b> a creative↔cella kötés <code>(mc_number, mc_variant)</code> alapján jön létre, tengely nélkül — így a mátrixban az egyik kampány cellájánál a másik kampány kreatívjai is megjelennek. A képek alatt látszik, mi ütközik mivel.</p>
            <p><b>Ez jelöltlista, nem ítélet.</b> A „különböző kampány" fájlnév-heurisztikából jön (a rendition-jelölőket — <code>creative_asset</code>, <code>image-only</code> — kiszűrve), így maradhat benne olyan sor, ahol valójában egy kampány két névváltozatáról van szó.</p>
          </div>${overlapCards}`
        : panelFor(t.id as Kind)
    }</section>`,
  ).join("");

  const html = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MC-szám ütközések — Erste</title>
<style>
  :root {
    --ink: #0f172a; --muted: #64748b; --line: #e2e8f0; --bg: #f8fafc; --card: #fff;
    --dco: #0ea5e9; --non: #a855f7;
    --twin: #16a34a; --clash: #dc2626; --dup: #d97706;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .page { max-width: 1400px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .subtitle { color: var(--muted); margin: 0 0 2rem; }
  .section-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); font-weight: 600; margin: 2.5rem 0 .75rem; }
  .intro { background: var(--card); border: 1px solid var(--line); border-radius: .6rem;
    padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; }
  .intro p { margin: 0 0 .7rem; }
  .intro p:last-child { margin-bottom: 0; }
  .legend { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin-top: 1rem; }
  .legend div { font-size: .82rem; color: var(--muted); }
  .summary { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .stat-tile { background: var(--card); border: 1px solid var(--line); border-radius: .6rem;
    padding: .8rem 1.1rem; min-width: 9rem; }
  .stat-tile__n { font-size: 1.5rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .stat-tile__l { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  table { width: 100%; border-collapse: separate; border-spacing: 0 .75rem; }
  thead th { text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); padding: 0 1rem .25rem; font-weight: 600; }
  .cell { background: var(--card); border: 1px solid var(--line); padding: 1rem;
    vertical-align: top; }
  .cell--dco { border-radius: .6rem 0 0 .6rem; border-right: 0; width: 26%; }
  .cell--non { border-right: 0; border-left: 0; width: 26%; }
  .cell--note { border-radius: 0 .6rem .6rem 0; border-left: 0; }
  .cell__head { display: flex; align-items: center; gap: .5rem; margin-bottom: .6rem; }
  .mc-label { font-weight: 650; font-variant-numeric: tabular-nums; }
  .axis-tag { font-size: .62rem; text-transform: uppercase; letter-spacing: .07em;
    padding: .12rem .4rem; border-radius: .25rem; color: #fff; font-weight: 600; }
  .axis-tag--dco { background: var(--dco); }
  .axis-tag--non { background: var(--non); }
  .banner { display: block; border: 1px solid var(--line); border-radius: .3rem; max-width: 100%; height: auto; }
  .static-creative { display: block; border: 1px solid var(--line); border-radius: .3rem;
    width: 300px; max-width: 100%; height: auto; }
  .cell__caption { font-size: .72rem; color: var(--muted); margin: .4rem 0 .8rem; }
  .axis-list { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
  .axis-row { border-top: 1px solid var(--line); padding-top: .5rem; font-size: .8rem; }
  .axis-row__meta { color: var(--muted); font-size: .72rem; margin-top: .15rem; }
  .axis-row__extra { margin-top: .25rem; font-size: .75rem; color: #475569; }
  .variant-chip { display: inline-block; min-width: 1.2rem; text-align: center;
    background: #f1f5f9; border: 1px solid var(--line); border-radius: .25rem;
    padding: 0 .25rem; font-weight: 600; font-size: .72rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .72rem; }
  code.topic { color: #334155; word-break: break-all; }
  code.cls, code.fname { color: var(--muted); word-break: break-all; }
  .status-badge { font-size: .62rem; text-transform: uppercase; letter-spacing: .05em;
    padding: .05rem .3rem; border-radius: .2rem; border: 1px solid var(--line); }
  .status-badge--active { color: #15803d; border-color: #bbf7d0; background: #f0fdf4; }
  .status-badge--inactive { color: #b45309; border-color: #fde68a; background: #fffbeb; }
  .status-badge--incoming, .status-badge--preview { color: #4338ca; border-color: #c7d2fe; background: #eef2ff; }
  .kind-badges { display: flex; gap: .35rem; flex-wrap: wrap; margin-bottom: .6rem; }
  .kind-badge { font-size: .68rem; font-weight: 600; padding: .15rem .5rem; border-radius: .25rem; color: #fff; }
  .kind-badge--twin { background: var(--twin); }
  .kind-badge--clash { background: var(--clash); }
  .kind-badge--dup { background: var(--dup); }
  .note { margin: 0; font-size: .85rem; }
  .tab-bar { display: flex; gap: .25rem; flex-wrap: wrap; border-bottom: 1px solid var(--line);
    margin: 2rem 0 1.25rem; }
  .tab { appearance: none; background: none; border: 1px solid transparent; border-bottom: 0;
    border-radius: .45rem .45rem 0 0; padding: .55rem .9rem; font: inherit; font-size: .85rem;
    font-weight: 550; color: var(--muted); cursor: pointer; display: flex; align-items: center;
    gap: .45rem; margin-bottom: -1px; }
  .tab:hover { color: var(--ink); background: #f1f5f9; }
  .tab--active { background: var(--card); border-color: var(--line); color: var(--ink); }
  .tab__n { font-size: .7rem; font-variant-numeric: tabular-nums; background: #e2e8f0;
    color: #475569; border-radius: 999px; padding: .05rem .4rem; }
  .tab--active .tab__n { background: var(--ink); color: #fff; }
  .ov-card { background: var(--card); border: 1px solid var(--line); border-radius: .6rem;
    padding: 1rem; margin-bottom: .75rem; }
  .ov-card__head { display: flex; align-items: center; gap: .5rem; margin-bottom: .75rem; }
  .ov-card__head .ov-n { margin-left: auto; }
  .ov-card__camps { display: flex; gap: 1rem; flex-wrap: wrap; }
  .ov-camp { margin: 0; width: 200px; }
  .ov-camp img { display: block; width: 100%; height: auto; border: 1px solid var(--line);
    border-radius: .3rem; background: #f1f5f9; }
  .ov-camp figcaption { margin-top: .4rem; display: flex; flex-direction: column; gap: .15rem;
    word-break: break-all; }
  .ov-camp__meta { display: flex; align-items: center; justify-content: space-between;
    gap: .5rem; margin-top: .25rem; }
  .product-tags { display: flex; gap: .2rem; flex-wrap: wrap; }
  .product-tag { font-size: .62rem; font-weight: 700; letter-spacing: .04em;
    padding: .1rem .35rem; border-radius: .25rem; color: #fff; background: #64748b; }
  .product-tag--szk { background: #0d9488; }
  .product-tag--sza { background: #2563eb; }
  .product-tag--hitel { background: #9333ea; }
  .product-tag--hk { background: #db2777; }
  .product-tag--val { background: #ea580c; }
  .product-tag--market { background: #0891b2; }
  .product-tag--ltp { background: #65a30d; }
  .ov-card__body { display: grid; grid-template-columns: 1fr minmax(260px, 380px); gap: 1.5rem;
    align-items: start; }
  .ov-ref { text-align: right; display: grid; gap: .9rem; }
  .ov-ref__block { border-left: 2px solid var(--line); padding-left: .8rem; }
  .ov-ref__k { font-size: .68rem; text-transform: uppercase; letter-spacing: .07em;
    color: var(--muted); font-weight: 600; margin-bottom: .35rem; }
  .ov-ref__hit { font-size: .78rem; padding: .3rem 0; border-top: 1px solid var(--line); }
  .ov-ref__hit:first-of-type { border-top: 0; }
  .ov-ref__hit .mc-label { margin-right: .35rem; }
  .ov-ref__hit .status-badge { margin-right: .35rem; }
  .ov-ref__hit code.topic { display: block; word-break: break-all; margin-top: .1rem; }
  .ov-ref__hl { display: block; color: #475569; margin-top: .15rem; }
  .ov-ref__none { font-size: .78rem; color: var(--muted); font-style: italic; }
  @media (max-width: 1000px) { .ov-card__body { grid-template-columns: 1fr; }
    .ov-ref { text-align: left; } }
  .panel[hidden] { display: none !important; }
  .ov-table { width: 100%; border-collapse: collapse; border-spacing: 0; margin-top: 1rem; }
  .ov-table th { text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); padding: .3rem .6rem; border-bottom: 1px solid var(--line); }
  .ov-table td { padding: .45rem .6rem; border-bottom: 1px solid var(--line); font-size: .82rem; }
  .ov-mc { font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ov-mc .variant-chip { margin-left: .35rem; }
  .ov-vs { color: var(--muted); font-size: .75rem; }
  .ov-n { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
  .empty-state { border: 1px dashed var(--line); border-radius: .3rem; padding: 2rem 1rem;
    text-align: center; color: var(--muted); font-size: .78rem; }
  footer { margin-top: 3rem; color: var(--muted); font-size: .78rem; }
  @media (max-width: 900px) {
    .cell, .cell--dco, .cell--non, .cell--note { display: block; width: auto;
      border: 1px solid var(--line); border-radius: .6rem; margin-bottom: .4rem; }
    thead { display: none; }
  }
</style>
</head>
<body>
<div class="page">
  <h1>MC-szám ütközések</h1>
  <p class="subtitle">Erste · ${items.length} olyan MC-szám, amit mindkét számozási tengely használ · pillanatkép: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</p>

  <div class="intro">
    <p><b>Miért lehetséges egyáltalán az ütközés?</b> A rendszerben az MC-szám kiosztása <b>tengelyenként</b> történik. A <span class="axis-tag axis-tag--dco">DCO</span> tengelyen a valódi kampány-kártyák élnek (audience-ökhöz kötve), a <span class="axis-tag axis-tag--non">nonDCO</span> tengelyen a statikus kreatívok (csatornákhoz kötve: <code>ch_soc</code>, <code>ch_disp</code>, …). A két tengely <b>független számtér</b> — ezért ugyanaz a szám egyszerre jelölhet egy DCO kártyát és egy statikus kreatívot. Egy tengelyen belül viszont egy szám soha nem lép át témát.</p>
    <p>Ez a szabály <b>szándékosan</b> engedi meg az ikerpárt: egy DCO kártya és a hozzá tartozó statikus kivágat ugyanazt a számot viseli. A baj akkor van, ha a szám <b>két nem összetartozó kampányt</b> köt össze — ilyenkor a szám többé nem azonosít semmit, és a riportban két különböző dolog folyik össze.</p>
    <div class="legend">
      <div><span class="kind-badge kind-badge--twin">Szándékos ikerpár</span> ugyanaz a kampány két formában — a közös szám helyes</div>
      <div><span class="kind-badge kind-badge--clash">Valódi ütközés</span> két nem összetartozó kampány — a szám félrevezet</div>
      <div><span class="kind-badge kind-badge--dup">nonDCO duplikáció</span> ugyanaz a statikus kétszer importálva, két téma alatt</div>
    </div>
  </div>

  <div class="summary">
    <div class="stat-tile"><div class="stat-tile__n">${items.length}</div><div class="stat-tile__l">ütköző szám</div></div>
    <div class="stat-tile"><div class="stat-tile__n">${counts.twin}</div><div class="stat-tile__l">ikerpár</div></div>
    <div class="stat-tile"><div class="stat-tile__n">${counts.clash}</div><div class="stat-tile__l">valódi ütközés</div></div>
    <div class="stat-tile"><div class="stat-tile__n">${counts.dup}</div><div class="stat-tile__l">nonDCO duplikáció</div></div>
  </div>

  ${tabsHtml}
  ${panelsHtml}

  <footer>
    A DCO bannerek az alkalmazás saját sablon-pipeline-ján készültek (<code>templates/html</code>, 300×250, headless Chromium), a statikus kreatívok az objektumtárból származnak. Minden kép be van ágyazva — a fájl önállóan, hálózat nélkül is megnyitható.
    <br>Már javított esetek, ezért nincsenek a listán: <b>335→398</b> és <b>336→399</b> (SZK/VAL beerste bankváltás, a MARKET genZbefektetes sorozattal ütközött), valamint <b>MC5→MC78</b> (VAL Társasházi Számlacsomag — a 78 nem üres luk, hanem a saját statikus párja) és <b>MC334→MC312</b> (a genZbefektetes „e" statikus, ami az SZK kamatkedvezmény DCO kártyával ütközött; a fájlnevek a DB-ben és a Drive leadás-mappájában is átírva).
  </footer>
</div>
<script>
  // Plain tab switching: one panel visible at a time, no dependencies.
  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach(function (b) {
        b.classList.toggle("tab--active", b === btn);
      });
      document.querySelectorAll(".panel").forEach(function (p) {
        p.hidden = p.dataset.panel !== id;
      });
    });
  });
</script>
</body>
</html>`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`wrote ${OUT} (${kb} KB), ${items.length} rows`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
