// An MC's HTML render as an ad-server-ready HTML5 bundle — the one transform
// behind `export:bundle` + `cleanup:bundle` and the share gallery's Download.
// Two steps, because the scripts write the raw export to disk between them:
//
//   renderBundle — the editor's inline render made standalone: the <base> the
//     inline mode injects is dropped, the template's own files go next to
//     index.html, /api/drive/proxy/<file> refs become relative and their bytes
//     come from storage.
//   cleanBundle — the hand-off copy: no feed layer (dynamic.content.js,
//     DynAdsHelper — the content is baked in), no video slot, the Adform DHTML
//     library actually loaded so dhtml.getVar('clickTAG') answers, and a click
//     URL that is never empty. The THM layer stays, loading included: HK/SZK
//     creatives write their date-dependent THM from thm.json by pmmid, and on
//     any other pmmid it is a no-op.
//
// Every cut is anchored on exact template markup. A marker that is missing
// means a different template, and cleanBundle throws rather than ship a
// half-cleaned file.

import JSZip from "jszip";
import type { TextFormatting, messages } from "@/db/schema";
import { renderTemplate } from "@/lib/render";
import { listTemplateFiles, readTemplate, readTemplateFile } from "@/lib/templates";
import { getFileByFilename } from "@/lib/entities/files";
import { readFileBytes } from "@/lib/storage";

type MessageRow = typeof messages.$inferSelect;

/** File name → bytes, flat: index.html at the root, as every ad server expects. */
export type BundleFiles = Map<string, Buffer>;

const PROXY_PREFIX = "/api/drive/proxy/";

// The template files a bundle never needs: index.html/template.json are render
// inputs, main.css + the size CSS are inlined by the render.
const RENDER_INPUTS = new Set(["index.html", "template.json", "main.css"]);
// What the hand-off copy drops: the feed layer and the video placeholder.
const CLEAN_DROPS = new Set(["dynamic.content.js", "emptyvideo.mp4"]);

export class BundleTemplateError extends Error {}

/** True when the MC's template renders to an HTML5 bundle cleanBundle knows. */
export function bundleableTemplate(templateName: string | null): boolean {
  if (!templateName) return false;
  const t = readTemplate(templateName);
  if (!t || t.kind !== "html") return false;
  const index = readTemplateFile(templateName, "index.html");
  return index !== null && ADFORM_BLOCK_RE.test(index.toString("utf8"));
}

export async function renderBundle(o: {
  clientId: number;
  message: MessageRow;
  size: string;
  textFormatting: TextFormatting[];
}): Promise<BundleFiles> {
  const label = `MC${o.message.number}${o.message.variant}`;
  const templateName = o.message.template;
  if (!templateName) throw new BundleTemplateError(`${label} has no template — nothing to render`);
  const template = readTemplate(templateName);
  if (!template || template.kind !== "html") {
    throw new BundleTemplateError(`template "${templateName}" is missing or not an html template`);
  }

  const files: BundleFiles = new Map();
  let { html } = renderTemplate({
    templateName,
    size: o.size,
    message: o.message as unknown as Record<string, unknown>,
    textFormatting: o.textFormatting,
    inline: true,
  });
  html = html.replace(/<base\s+href="[^"]*\/api\/templates\/[^"]*">\s*/i, "");

  for (const f of listTemplateFiles(templateName)!) {
    if (f.size || RENDER_INPUTS.has(f.name)) continue;
    files.set(f.name, readTemplateFile(templateName, f.name)!);
  }

  // Every proxied creative file the render references — collected from the
  // HTML itself, so whatever placeholder emitted it is covered.
  const proxied = new Set<string>();
  html = html.replace(/\/api\/drive\/proxy\/([^"'()\s]+)/g, (_, enc: string) => {
    const name = decodeURIComponent(enc);
    proxied.add(name);
    return encodeURI(name);
  });
  for (const name of proxied) {
    const file = await getFileByFilename(o.clientId, name);
    if (!file) throw new Error(`${label} ${o.size}: ${name} is not an uploaded file in this client`);
    files.set(name, await readFileBytes(file.storagePath));
  }
  if (html.includes(PROXY_PREFIX)) {
    throw new Error(`${label} ${o.size}: a ${PROXY_PREFIX} ref survived the rewrite`);
  }

  files.set("index.html", Buffer.from(html, "utf8"));
  return files;
}

// The template ships its Adform libs commented out (they cannot load in the
// editor's sandboxed preview). The whole block is replaced by the loader
// Adform's own templates use: window.API_URL lets Adform's preview and
// validator swap the library in.
const ADFORM_BLOCK_RE =
  /[ \t]*<!-- UNCOMMENT THESE FOR ADFORM UPLOAD -->\s*<!--[\s\S]*?-->\s*<!-- UNCOMMENT THESE FOR ADFORM UPLOAD -->[ \t]*\n/;
export const ADFORM_LOADER = `    <!-- Adform Static required scripts -->
    <script>
      document.write('<script src="' + (window.API_URL || 'https://s1.adform.net/banners/scripts/rmb/Adform.DHTML.js?bv=' + Math.random()) + '"><\\/script>');
    </script>
`;

const CUTS: { what: string; re: RegExp }[] = [
  {
    what: "dynamic.content.js <script>",
    re: /[ \t]*<script[^>]*\bsrc="dynamic\.content\.js[^"]*"[^>]*><\/script>[ \t]*\n/,
  },
  {
    what: "#videoWrapper element",
    re: /[ \t]*<div id="videoWrapper">[\s\S]*?<\/video>\s*<\/div>[ \t]*\n/,
  },
];

const CLICK_META_RE = /<meta name="click_url" content="([^"]*)">/;

export type CleanBundleInfo = {
  /** Re-letters the bundle (advert_variant meta, manifest description). */
  variant: string;
  /** Manifest title — the MC's topic. */
  title: string;
};

/**
 * The hand-off copy of a rendered bundle. The click URL is the render's own
 * (the MC's Final Trafficked URL, in <meta name="click_url">); an MC without one
 * gets the template manifest's clickTAG, so the click never lands on '#'. The
 * ad server's clickTAG still wins at serving time.
 */
export function cleanBundle(files: BundleFiles, size: string, info: CleanBundleInfo): BundleFiles {
  const index = files.get("index.html");
  const manifestBytes = files.get("manifest.json");
  if (!index || !manifestBytes) throw new BundleTemplateError(`${size}: index.html or manifest.json missing`);
  let html = index.toString("utf8");

  if (!ADFORM_BLOCK_RE.test(html)) throw new BundleTemplateError(`${size}: Adform script block not found`);
  html = html.replace(ADFORM_BLOCK_RE, ADFORM_LOADER);
  for (const cut of CUTS) {
    if (!cut.re.test(html)) throw new BundleTemplateError(`${size}: ${cut.what} not found`);
    html = html.replace(cut.re, "");
  }
  if (/dynamic\.content\.js|DynAdsHelper-|videoWrapper"/.test(html)) {
    throw new Error(`${size}: a dynamic-content / video ref survived the cleanup`);
  }

  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const clickMeta = html.match(CLICK_META_RE);
  if (!clickMeta) throw new BundleTemplateError(`${size}: <meta name="click_url"> not found`);
  const clickUrl = clickMeta[1] || manifest.clicktags?.clickTAG;
  if (!clickUrl) throw new Error(`${size}: no click URL — neither the MC nor the template manifest has one`);
  html = html.replace(CLICK_META_RE, `<meta name="click_url" content="${clickUrl}">`);

  const sourceVariant = html.match(/<meta name="advert_variant" content="([^"]*)">/)?.[1];
  if (!sourceVariant) throw new BundleTemplateError(`${size}: <meta name="advert_variant"> missing or empty`);
  if (info.variant !== sourceVariant) {
    html = html.replace(
      `<meta name="advert_variant" content="${sourceVariant}">`,
      `<meta name="advert_variant" content="${info.variant}">`,
    );
  }
  const number = html.match(/<meta name="advert_mc" content="([^"]*)">/)?.[1];
  if (!number) throw new BundleTemplateError(`${size}: <meta name="advert_mc"> missing or empty`);

  const [w, h] = size.split("x").map(Number);
  manifest.title = info.title;
  manifest.description = `MC${number}${info.variant} ${size}`;
  manifest.width = w;
  manifest.height = h;
  manifest.clicktags = { ...manifest.clicktags, clickTAG: clickUrl };

  const out: BundleFiles = new Map();
  for (const [name, bytes] of files) {
    if (CLEAN_DROPS.has(name) || name === "index.html" || name === "manifest.json") continue;
    out.set(name, bytes);
  }
  out.set("index.html", Buffer.from(html, "utf8"));
  out.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 4) + "\n", "utf8"));
  return out;
}

/** A draft names its product; a placed card's topic starts with it. */
export function bundleProduct(topic: string, draftProduct: string | null): string {
  return draftProduct ?? topic.split("_")[0]!;
}

// The library's creative-name convention (parse-creative-filename.ts): brand,
// product, MC<n>, variant, keywords, _nN, _WxH. Keywords are the topic's tags
// after the product, minus the "NA" placeholder; "html5" marks the deliverable.
export function packageZipName(o: {
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

export async function zipBundle(files: BundleFiles): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
