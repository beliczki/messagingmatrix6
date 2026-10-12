// Clean the bundles `export:bundle` wrote into hand-off copies.
//
//   npm run cleanup:bundle -- ~/Downloads/bird
//   npm run cleanup:bundle -- ~/Downloads/bird --variant b
//
// Reads every <size>/ folder under the given dir and writes a cleaned copy to
// <dir>/_cleanup/<size>/ — the source folders stay as they are, so the export
// can be rerun and recleaned. Per size:
//   - index.html loses the dynamic.content.js <script> (its replaceContent is
//     only called in an Adform context, which these bundles never are), the THM
//     layer (the thm.json fetch in <head>, the PHASE 5 functions and the PMMID
//     step that calls them), the Adform.DynAdsHelper <script> and the
//     #videoWrapper element;
//   - dynamic.content.js, thm.json and emptyvideo.mp4 are not copied;
//   - manifest.json gets width/height from the size, title from the MC's topic,
//     description "MC<n><v> <size>". The clicktag stays as the template has it;
//   - each size is also zipped beside the folders, named the way the Creative
//     Library parses a creative — ERSTE_SZA_MC411_b_<topic tags>_html5_n1_300x250.zip
//     — so the zips upload as HTML5 packages straight onto that MC and variant.
//
// --variant re-letters the bundle (advert_variant meta, manifest, zip name):
// an HTML5 version of MC411a delivered as MC411b sits in its own draft variant
// instead of joining the image ladder of the `a` it was rendered from. --n sets
// the _nN version token (default 1).
// Every cut is anchored on exact template markup. A marker that is missing
// means a different template, and the script stops rather than ship a
// half-cleaned file.
//
// The MC comes from the bundle's own <meta name="advert_mc"/"advert_variant">;
// the topic from the DB (ACTIVE_CLIENT_KEY picks the client; npm script: erste).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import JSZip from "jszip";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { messages } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";

const SIZE_DIR_RE = /^(\d+)x(\d+)$/;
const SKIP_FILES = new Set(["dynamic.content.js", "thm.json", "emptyvideo.mp4"]);

const CUTS: { what: string; re: RegExp }[] = [
  {
    what: "THM <head> block (thm.json fetch)",
    re: /[ \t]*<!-- THM data \(date-dependent content\)[^\n]*-->\s*<script>[\s\S]*?<\/script>\s*\n/,
  },
  {
    what: "dynamic.content.js <script>",
    re: /[ \t]*<script[^>]*\bsrc="dynamic\.content\.js[^"]*"[^>]*><\/script>[ \t]*\n/,
  },
  {
    // Feed variables are not used — the content is baked in. The DHTML lib
    // stays in the (commented) Adform block: the click handler reads clickTAG
    // through it.
    what: "Adform.DynAdsHelper <script>",
    re: /[ \t]*<script[^>]*\bsrc="[^"]*Adform\.DynAdsHelper[^"]*"[^>]*><\/script>[ \t]*\n/,
  },
  {
    what: "#videoWrapper element",
    re: /[ \t]*<div id="videoWrapper">[\s\S]*?<\/video>\s*<\/div>[ \t]*\n/,
  },
  {
    what: "THM step in onAdInitialized",
    re: /[ \t]*\/\/ 4\. Check PMMID for SZK or HK[\s\S]*?skipping THM update'\);\s*\}[ \t]*\n/,
  },
  {
    what: "PHASE 5 THM functions",
    re: /[ \t]*\/\/ =+\n[ \t]*\/\/ PHASE 5: THM LOGIC[\s\S]*?(?=[ \t]*\/\/ =+\n[ \t]*\/\/ PHASE 6:)/,
  },
];

function metaContent(html: string, name: string): string {
  const m = html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
  if (!m || !m[1]) throw new Error(`<meta name="${name}"> missing or empty`);
  return m[1];
}

async function mcInfo(
  clientId: number,
  number: number,
  variant: string,
): Promise<{ topic: string; product: string }> {
  const rows = await db
    .select({ topic: messages.topic, draftProduct: messages.draftProduct })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, number),
        eq(messages.variant, variant),
      ),
    );
  if (rows.length === 0) throw new Error(`MC${number}${variant} not found in this client`);
  // One card on many audience rows carries one topic — say so if it doesn't.
  const topics = [...new Set(rows.map((r) => r.topic))];
  if (topics.length > 1) {
    throw new Error(`MC${number}${variant} rows disagree on topic: ${topics.join(", ")}`);
  }
  const topic = topics[0];
  if (!topic) throw new Error(`MC${number}${variant} has no topic to name the bundle by`);
  // A draft names its product; a placed card's topic starts with it.
  const product = rows.find((r) => r.draftProduct)?.draftProduct ?? topic.split("_")[0]!;
  return { topic, product };
}

// The library's creative-name convention (parse-creative-filename.ts): brand,
// product, MC<n>, variant, keywords, _nN, _WxH. Keywords are the topic's tags
// after the product, minus the "NA" placeholder; "html5" marks the deliverable.
function packageZipName(o: {
  brand: string;
  product: string;
  number: number;
  variant: string;
  topic: string;
  n: number;
  size: string;
}): string {
  const tags = o.topic
    .split("_")
    .slice(1)
    .filter((t) => t && t.toUpperCase() !== "NA");
  return [o.brand, o.product, `MC${o.number}`, o.variant, ...tags, "html5", `n${o.n}`, o.size].join("_") + ".zip";
}

function parseArgs(argv: string[]) {
  let dir: string | null = null;
  let variant: string | null = null;
  let n = 1;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--variant") variant = (argv[++i] ?? "").toLowerCase();
    else if (a === "--n") n = Number(argv[++i]);
    else dir = a;
  }
  if (!dir) throw new Error("usage: cleanup-html-bundle <bundle dir> [--variant b] [--n 1]");
  if (variant !== null && !/^[a-z]$/.test(variant)) throw new Error(`--variant must be one letter, got "${variant}"`);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--n must be a positive integer`);
  return { root: path.resolve(dir.replace(/^~(?=\/|$)/, os.homedir())), variant, n };
}

async function main() {
  const { root, variant: newVariant, n } = parseArgs(process.argv.slice(2));
  const sizes = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SIZE_DIR_RE.test(e.name))
    .map((e) => e.name);
  if (sizes.length === 0) throw new Error(`no <W>x<H>/ folders in ${root}`);

  const client = await getActiveClient();
  const infoCache = new Map<string, { topic: string; product: string }>();

  for (const size of sizes) {
    const src = path.join(root, size);
    const dst = path.join(root, "_cleanup", size);
    let html = fs.readFileSync(path.join(src, "index.html"), "utf8");

    for (const cut of CUTS) {
      if (!cut.re.test(html)) throw new Error(`${size}: ${cut.what} not found`);
      html = html.replace(cut.re, "");
    }
    if (/dynamic\.content\.js|thm\.json|DynAdsHelper-|videoWrapper"/.test(html)) {
      throw new Error(`${size}: a dynamic-content / THM / video ref survived the cleanup`);
    }

    const number = Number(metaContent(html, "advert_mc"));
    const sourceVariant = metaContent(html, "advert_variant");
    // The topic belongs to the NUMBER (it never spans topics), so the source
    // letter answers for the new one too — which may not exist yet.
    const sourceKey = `${number}${sourceVariant}`;
    if (!infoCache.has(sourceKey)) {
      infoCache.set(sourceKey, await mcInfo(client.id, number, sourceVariant));
    }
    const { topic, product } = infoCache.get(sourceKey)!;
    const variant = newVariant ?? sourceVariant;
    if (variant !== sourceVariant) {
      html = html.replace(
        `<meta name="advert_variant" content="${sourceVariant}">`,
        `<meta name="advert_variant" content="${variant}">`,
      );
    }
    const [, w, h] = size.match(SIZE_DIR_RE)!;

    const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
    manifest.title = topic;
    manifest.description = `MC${number}${variant} ${size}`;
    manifest.width = Number(w);
    manifest.height = Number(h);

    fs.mkdirSync(dst, { recursive: true });
    const copied: string[] = [];
    for (const f of fs.readdirSync(src)) {
      if (SKIP_FILES.has(f) || f === "index.html" || f === "manifest.json") continue;
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
      copied.push(f);
    }
    fs.writeFileSync(path.join(dst, "index.html"), html);
    fs.writeFileSync(path.join(dst, "manifest.json"), JSON.stringify(manifest, null, 4) + "\n");

    // The folder's contents at the zip's top level: index.html at the root is
    // what the library's package check (and every ad server) expects.
    const zip = new JSZip();
    for (const f of fs.readdirSync(dst)) zip.file(f, fs.readFileSync(path.join(dst, f)));
    const zipName = packageZipName({
      brand: client.key.toUpperCase(),
      product,
      number,
      variant,
      topic,
      n,
      size,
    });
    fs.writeFileSync(
      path.join(root, "_cleanup", zipName),
      await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    );
    console.log(`${size}: index.html + manifest.json + ${copied.join(", ")} → ${zipName}`);
  }
  console.log(`wrote ${sizes.length} cleaned bundle(s) → ${path.join(root, "_cleanup")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
