// Clean the bundles `export:bundle` wrote into hand-off copies.
//
//   npm run cleanup:bundle -- ~/Downloads/bird
//   npm run cleanup:bundle -- ~/Downloads/bird --variant b
//
// Reads every <size>/ folder under the given dir and writes a cleaned copy to
// <dir>/_cleanup/<size>/ — the source folders stay as they are, so the export
// can be rerun and recleaned. The clean itself is cleanBundle
// (src/lib/html5-bundle.ts — the share gallery's Download uses the same one):
// no feed layer or video slot, the Adform DHTML library loaded so the click
// works, the THM layer kept. Here:
//   - manifest.json gets title = the MC's topic;
//   - each size is also zipped beside the folders, named the way the Creative
//     Library parses a creative — ERSTE_SZA_MC411_b_<topic tags>_html5_n1_300x250.zip
//     — so the zips upload as HTML5 packages straight onto that MC and variant.
//
// --variant re-letters the bundle (advert_variant meta, manifest, zip name):
// an HTML5 version of MC411a delivered as MC411b sits in its own draft variant
// instead of joining the image ladder of the `a` it was rendered from. --n sets
// the _nN version token (default 1).
//
// The MC comes from the bundle's own <meta name="advert_mc"/"advert_variant">;
// the topic from the DB (ACTIVE_CLIENT_KEY picks the client; npm script: erste).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { messages } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";
import {
  bundleProduct,
  cleanBundle,
  packageZipName,
  zipBundle,
  type BundleFiles,
} from "../src/lib/html5-bundle";

const SIZE_DIR_RE = /^(\d+)x(\d+)$/;

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
  const draftProduct = rows.find((r) => r.draftProduct)?.draftProduct ?? null;
  return { topic, product: bundleProduct(topic, draftProduct) };
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
    const files: BundleFiles = new Map(
      fs.readdirSync(src).map((f) => [f, fs.readFileSync(path.join(src, f))]),
    );
    const html = files.get("index.html")!.toString("utf8");

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

    const cleaned = cleanBundle(files, size, { variant, title: topic });
    fs.mkdirSync(dst, { recursive: true });
    for (const [name, bytes] of cleaned) fs.writeFileSync(path.join(dst, name), bytes);

    const zipName = packageZipName({
      brand: client.key.toUpperCase(),
      product,
      number,
      variant,
      topic,
      n,
      size,
    });
    fs.writeFileSync(path.join(root, "_cleanup", zipName), await zipBundle(cleaned));
    console.log(`${size}: ${[...cleaned.keys()].join(", ")} → ${zipName}`);
  }
  console.log(`wrote ${sizes.length} cleaned bundle(s) → ${path.join(root, "_cleanup")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
