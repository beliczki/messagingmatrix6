// Clean the bundles `export:bundle` wrote into hand-off copies.
//
//   npm run cleanup:bundle -- ~/Downloads/bird
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
//     description "MC<n><v> <size>". The clicktag stays as the template has it.
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

async function topicOf(clientId: number, number: number, variant: string): Promise<string> {
  const rows = await db
    .select({ topic: messages.topic })
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
  return topics[0]!;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: cleanup-html-bundle <bundle dir>");
  const root = path.resolve(arg.replace(/^~(?=\/|$)/, os.homedir()));
  const sizes = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SIZE_DIR_RE.test(e.name))
    .map((e) => e.name);
  if (sizes.length === 0) throw new Error(`no <W>x<H>/ folders in ${root}`);

  const client = await getActiveClient();
  const topicCache = new Map<string, string>();

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
    const variant = metaContent(html, "advert_variant");
    const key = `${number}${variant}`;
    if (!topicCache.has(key)) topicCache.set(key, await topicOf(client.id, number, variant));
    const [, w, h] = size.match(SIZE_DIR_RE)!;

    const manifest = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8"));
    manifest.title = topicCache.get(key);
    manifest.description = `MC${key} ${size}`;
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
    console.log(`${size}: index.html + manifest.json + ${copied.join(", ")}`);
  }
  console.log(`wrote ${sizes.length} cleaned bundle(s) → ${path.join(root, "_cleanup")}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
