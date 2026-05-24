import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/db/schema";

// Template filesystem scanner. Spec §3.12 + §17.12 — single global folder
// shared across clients; per-client visibility flags decide what each client
// sees in dropdowns.
//
// manifest.json schema (extended 2026-05-23 for D1 template typing):
//   {
//     "version": "1.0",
//     "title": "human-readable name",
//     "description": "free-form text shown in editor + preview",
//     "kind": "html" | "adobe" | "figma" | "after_effects"   // optional, default "html"
//     "figma_url": "https://www.figma.com/file/…"            // optional, only for kind=figma
//     "preview": "preview.png"                               // optional, filename inside the
//                                                            // template folder. When unset and
//                                                            // kind != html, auto-discover
//                                                            // preview.{png,jpg,jpeg,webp,gif}.
//     // ── HTML-only keys (ignored for non-html kinds) ──
//     "width": …, "height": …, "events": …, "clicktags": …, "source": "index.html"
//   }
//
// Non-html templates have NO sized variants, NO placeholders. They live in
// `templates/<name>/` like HTML templates but only need manifest.json + a
// preview image. They surface in the same dropdowns and the matrix cell
// preview branches on `kind` to either iframe-render (html) or show the
// preview image (adobe/figma/after_effects).

export type TemplatePlaceholder = {
  name: string;
  type: string;
  default: string;
  binding?: string;
  /** For type=tag — list of selectable class options. */
  options?: string[];
  /** Pattern path under template.json — e.g. ["headline", "headline_text_1"]. */
  path?: string[];
};

export const TEMPLATE_KINDS = [
  "html",
  "adobe",
  "figma",
  "after_effects",
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export type TemplateInfo = {
  name: string;
  /** Production type — drives matrix cell preview behavior. Defaults to "html"
   *  when manifest.kind is absent or unknown (so every existing template stays
   *  HTML-render-as-iframe with no migration). */
  kind: TemplateKind;
  /** WIDTHxHEIGHT identifiers parsed from {w}x{h}.css filenames. Always empty
   *  for non-html kinds (they have no sized variants). */
  sizes: string[];
  defaultSize: string | null;
  placeholders: TemplatePlaceholder[];
  /** Convenience: union of all placeholders[type=tag].options. */
  tagOptions: string[];
  /** Free-form description from manifest.description. */
  description: string | null;
  /** Filename of the preview image inside the template folder (e.g. "preview.png").
   *  Only meaningful for non-html kinds; html templates render their own iframe. */
  previewFile: string | null;
  /** External URL — currently only Figma file links (manifest.figma_url). */
  externalUrl: string | null;
};

const SIZE_RE = /^(\d+)x(\d+)\.css$/i;
const PREVIEW_EXTS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

function templatesRoot(): string {
  return process.env.TEMPLATES_ROOT
    ? path.resolve(process.cwd(), process.env.TEMPLATES_ROOT)
    : path.resolve(process.cwd(), "templates");
}

export function listTemplateFolders(): string[] {
  const root = templatesRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

function readTemplateJson(
  templateName: string,
): { default_size?: string; placeholders?: Record<string, unknown> } | null {
  const p = path.join(templatesRoot(), templateName, "template.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function readManifestJson(
  templateName: string,
): Record<string, unknown> | null {
  const p = path.join(templatesRoot(), templateName, "manifest.json");
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isTemplateKind(v: unknown): v is TemplateKind {
  return typeof v === "string" && (TEMPLATE_KINDS as readonly string[]).includes(v);
}

// Auto-discover preview.{png,jpg,jpeg,webp,gif} in the template dir. Used
// when manifest.preview is unset. Returns the filename (not the absolute path).
function discoverPreviewFile(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir);
  for (const ext of PREVIEW_EXTS) {
    const candidate = `preview.${ext}`;
    if (entries.includes(candidate)) return candidate;
  }
  return null;
}

export function readTemplate(name: string): TemplateInfo | null {
  const root = templatesRoot();
  const dir = path.join(root, name);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;

  const manifest = readManifestJson(name);
  const kind: TemplateKind = isTemplateKind(manifest?.kind) ? manifest.kind : "html";
  const description =
    typeof manifest?.description === "string" && manifest.description.trim() !== ""
      ? manifest.description
      : null;
  const externalUrl =
    kind === "figma" && typeof manifest?.figma_url === "string"
      ? manifest.figma_url
      : null;
  // Preview: manifest.preview wins; for non-html kinds, fall back to
  // auto-discover. For html kind, leave null — the iframe is the preview.
  let previewFile: string | null =
    typeof manifest?.preview === "string" ? manifest.preview : null;
  if (previewFile === null && kind !== "html") {
    previewFile = discoverPreviewFile(dir);
  }

  // HTML-only reads. Non-html templates have no sized variants and no
  // template.json placeholders.
  if (kind !== "html") {
    return {
      name,
      kind,
      sizes: [],
      defaultSize: null,
      placeholders: [],
      tagOptions: [],
      description,
      previewFile,
      externalUrl,
    };
  }

  // Sizes: discover from {w}x{h}.css filenames.
  const sizes = fs
    .readdirSync(dir)
    .map((f) => f.match(SIZE_RE))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => `${m[1]}x${m[2]}`)
    .sort();

  const tj = readTemplateJson(name);
  const placeholders: TemplatePlaceholder[] = [];
  const tagOptionsSet = new Set<string>();
  if (tj?.placeholders && typeof tj.placeholders === "object") {
    for (const [k, vRaw] of Object.entries(tj.placeholders)) {
      const v = vRaw as Record<string, unknown>;
      const type = typeof v.type === "string" ? v.type : "var";
      let options: string[] | undefined;
      if (type === "tag" && typeof v.options === "string") {
        options = v.options
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const o of options) tagOptionsSet.add(o);
      }
      placeholders.push({
        name: k,
        type,
        default: typeof v.default === "string" ? v.default : "",
        binding:
          typeof v["binding-messagingmatrix"] === "string"
            ? (v["binding-messagingmatrix"] as string)
            : undefined,
        options,
      });
    }
  }

  return {
    name,
    kind,
    sizes,
    defaultSize:
      typeof tj?.default_size === "string" ? tj.default_size : (sizes[0] ?? null),
    placeholders,
    tagOptions: [...tagOptionsSet],
    description,
    previewFile,
    externalUrl,
  };
}

export function listAllTemplates(): TemplateInfo[] {
  return listTemplateFolders()
    .map(readTemplate)
    .filter((t): t is TemplateInfo => !!t);
}

export function listVisibleTemplates(clientId: number): TemplateInfo[] {
  const visibility = readVisibleTemplatesConfig(clientId);
  const all = listAllTemplates();
  // If config is empty / not set, default to ALL templates visible (less
  // confusing for fresh clients than an empty dropdown).
  if (!visibility || Object.keys(visibility).length === 0) {
    return all;
  }
  return all.filter((t) => visibility[t.name] !== false);
}

function readVisibleTemplatesConfig(
  clientId: number,
): Record<string, boolean> | null {
  const row = db
    .select()
    .from(config)
    .where(
      and(
        eq(config.clientId, clientId),
        eq(config.key, "visibleTemplates"),
      ),
    )
    .get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, boolean>)
      : null;
  } catch {
    return null;
  }
}

// Read a single file under templates/{name}/.
export function readTemplateFile(name: string, file: string): Buffer | null {
  const p = safeTemplateFilePath(name, file);
  if (!p) return null;
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
  return fs.readFileSync(p);
}

const TEXT_EXTS = new Set([
  ".html",
  ".css",
  ".js",
  ".json",
  ".svg",
  ".txt",
  ".md",
]);

export type TemplateFileInfo = {
  /** filename relative to the template folder, e.g. "300x250.css" */
  name: string;
  ext: string;
  bytes: number;
  /** WIDTHxHEIGHT if the filename is a size CSS file. */
  size?: string;
  /** True if the file is editable as text in the editor. */
  isText: boolean;
};

export function listTemplateFiles(name: string): TemplateFileInfo[] | null {
  const dir = safeTemplateDir(name);
  if (!dir) return null;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out: TemplateFileInfo[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (e.name.startsWith(".")) continue;
    const ext = path.extname(e.name).toLowerCase();
    const stat = fs.statSync(path.join(dir, e.name));
    const sizeMatch = e.name.match(SIZE_RE);
    out.push({
      name: e.name,
      ext,
      bytes: stat.size,
      size: sizeMatch ? `${sizeMatch[1]}x${sizeMatch[2]}` : undefined,
      isText: TEXT_EXTS.has(ext),
    });
  }
  return out.sort(byTemplateFileOrder);
}

function byTemplateFileOrder(a: TemplateFileInfo, b: TemplateFileInfo): number {
  const rank = (f: TemplateFileInfo): number => {
    if (f.name === "index.html") return 0;
    if (f.name === "template.json") return 1;
    if (f.name === "main.css") return 2;
    if (f.size) return 3;
    if (f.name === "dynamic.content.js") return 4;
    if (f.isText) return 5;
    return 6;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (a.size && b.size) {
    // sort size CSS by area ascending
    const [aw, ah] = a.size.split("x").map((n) => parseInt(n, 10));
    const [bw, bh] = b.size.split("x").map((n) => parseInt(n, 10));
    return aw * ah - bw * bh;
  }
  return a.name.localeCompare(b.name);
}

export function writeTemplateFile(
  name: string,
  file: string,
  content: string | Buffer,
): { ok: true; bytes: number } | { ok: false; reason: "invalid_path" | "no_template" } {
  const dir = safeTemplateDir(name);
  if (!dir) return { ok: false, reason: "invalid_path" };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, reason: "no_template" };
  }
  const p = safeTemplateFilePath(name, file);
  if (!p) return { ok: false, reason: "invalid_path" };
  fs.writeFileSync(p, content);
  return { ok: true, bytes: fs.statSync(p).size };
}

export function templateExists(name: string): boolean {
  const dir = safeTemplateDir(name);
  return !!dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory();
}

const TEMPLATE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function createTemplate(name: string): { ok: true } | { ok: false; reason: "invalid_name" | "exists" } {
  if (!TEMPLATE_NAME_RE.test(name)) return { ok: false, reason: "invalid_name" };
  const dir = safeTemplateDir(name);
  if (!dir) return { ok: false, reason: "invalid_name" };
  if (fs.existsSync(dir)) return { ok: false, reason: "exists" };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="main.css" />
  <title>{{advert_name}}</title>
</head>
<body>
  <div class="ad">
    <h1>{{headline_text_1}}</h1>
    <p>{{copy_text_1}}</p>
    <a class="cta" href="{{click_url}}">{{cta_text}}</a>
  </div>
</body>
</html>
`,
  );
  fs.writeFileSync(
    path.join(dir, "main.css"),
    `.ad { font-family: sans-serif; }
.cta { display: inline-block; padding: 8px 16px; background: #000; color: #fff; }
`,
  );
  fs.writeFileSync(path.join(dir, "300x250.css"), `.ad { width: 300px; height: 250px; }
`);
  fs.writeFileSync(
    path.join(dir, "template.json"),
    JSON.stringify(
      {
        default_size: "300x250",
        placeholders: {
          headline_text_1: { type: "text", default: "", "binding-messagingmatrix": "Headline" },
          copy_text_1: { type: "text", default: "", "binding-messagingmatrix": "Copy_1" },
          cta_text: { type: "text", default: "Learn more", "binding-messagingmatrix": "CTA" },
          click_url: { type: "url", default: "", "binding-messagingmatrix": "Final_Trafficked_URL" },
          advert_name: { type: "var", default: "", "binding-messagingmatrix": "Name" },
        },
      },
      null,
      2,
    ) + "\n",
  );
  return { ok: true };
}

function safeTemplateDir(name: string): string | null {
  const root = templatesRoot();
  const safeName = path.normalize(name);
  if (
    safeName.includes("..") ||
    safeName.includes(path.sep) ||
    path.isAbsolute(safeName)
  ) {
    return null;
  }
  const p = path.join(root, safeName);
  if (!p.startsWith(root + path.sep) && p !== root) return null;
  return p;
}

function safeTemplateFilePath(name: string, file: string): string | null {
  const dir = safeTemplateDir(name);
  if (!dir) return null;
  const safeFile = path.normalize(file);
  if (
    safeFile.includes("..") ||
    safeFile.includes(path.sep) ||
    path.isAbsolute(safeFile)
  ) {
    return null;
  }
  const p = path.join(dir, safeFile);
  if (!p.startsWith(dir + path.sep)) return null;
  return p;
}

export function _setTemplatesRootForTests(p: string) {
  process.env.TEMPLATES_ROOT = p;
}
