// Template render. Spec §4.6 + §14.
// v5 source-of-truth: server.js populateTemplate() lines 1682-1737.
//
// Algorithm:
//   1. Load templates/{name}/index.html.
//   2. For each placeholder in template.json:
//      - Resolve value from message via binding-messagingmatrix.
//      - For image/video types, prepend path-messagingmatrix.
//      - Substitute {{placeholder}} occurrences with the resolved value.
//   3. Apply matching text_formatting rules (Spec §3.6) at placeholder
//      resolution: a rule applies only when its `text_original` equals the
//      entire resolved value (the same predicate the editor uses to list
//      rules under a field — never a substring hit) and formatting_scope +
//      formatting_mc_scope both match. Size-scoped rules win over universal
//      ones, mirroring pickVariantForSize in feed-spans.ts.
//
// We don't include the size CSS by default — v5's preview-iframe approach
// references size CSS via a relative <link>. Callers that want fully inlined
// HTML (share gallery / export) opt in via { inline: true }.

import fs from "node:fs";
import path from "node:path";
import { matchesScope, parseScope } from "@/lib/entities/text-formatting";
import { mcLabelFor } from "@/lib/mc-label";
import type { TextFormatting } from "@/db/schema";

export type RenderInput = {
  templateName: string;
  size: string;
  message: Record<string, unknown>;
  textFormatting?: TextFormatting[];
  /** Inline {size}.css and main.css into a <style> block. Default false. */
  inline?: boolean;
  /**
   * Disable CSS animations + transitions in the rendered output. Used by the
   * editor preview "skip animation" toggle. Spec §6.3.
   */
  skipAnimations?: boolean;
  /**
   * Silence the template's own console.log/debug/info in the rendered output
   * (console.warn / console.error are kept). Used by grid previews (Creative
   * Library) where hundreds of same-origin `srcDoc` iframes would otherwise
   * flood the parent DevTools console. Off for the editor + share gallery,
   * where the template's logs are useful.
   */
  quietConsole?: boolean;
  /**
   * Absolute origin (e.g. "https://erste.messagingmatrix.ai") for the injected
   * <base href>. A root-relative base ("/api/templates/<name>/") does NOT
   * resolve inside a `srcDoc` iframe — the browser falls back to the parent
   * page's origin at the ROOT, so every relative template asset (main.css,
   * dynamic.content.js, empty.png) 404s. An absolute base fixes it. Omitted =
   * root-relative fallback (fine for same-document `src`-loaded previews).
   */
  baseOrigin?: string;
};

export type RenderResult = {
  html: string;
};

type Placeholder = {
  type: string;
  default?: string;
  "binding-messagingmatrix"?: string;
  "path-messagingmatrix"?: string;
};

function templatesRoot(): string {
  return process.env.TEMPLATES_ROOT
    ? path.resolve(process.cwd(), process.env.TEMPLATES_ROOT)
    : path.resolve(process.cwd(), "templates");
}

// v5 binding names are PascalCase / snake_case; v6 message rows are camelCase.
// Allow both forms by normalising the lookup key.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// v5 binding → v6 column aliases. Only needed where the rename can't be
// reached by `normalize` (which already covers PascalCase ↔ camelCase and
// snake_case differences). Add entries when a template binding doesn't
// resolve via direct normalize match.
const BINDING_ALIASES: Record<string, string> = {
  // Template binding "CSS" was the v5 spreadsheet column; v6 stores it as customCss.
  css: "customcss",
};

function lookupField(
  message: Record<string, unknown>,
  binding: string,
): string {
  if (!binding) return "";
  const target = normalize(binding);
  const candidates = [target];
  const alias = BINDING_ALIASES[target];
  if (alias) candidates.push(alias);
  for (const [k, v] of Object.entries(message)) {
    const nk = normalize(k);
    if (candidates.includes(nk)) {
      if (v === null || v === undefined) return "";
      return String(v);
    }
  }
  return "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderTemplate(input: RenderInput): RenderResult {
  const root = templatesRoot();
  const dir = path.join(root, input.templateName);
  if (!fs.existsSync(dir)) {
    throw new Error(`Template not found: ${input.templateName}`);
  }
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html missing for template: ${input.templateName}`);
  }
  const tjPath = path.join(dir, "template.json");
  let templateJson: { placeholders?: Record<string, Placeholder> } = {};
  if (fs.existsSync(tjPath)) {
    try {
      templateJson = JSON.parse(fs.readFileSync(tjPath, "utf8"));
    } catch {
      // Invalid JSON — leave bindings empty so {{placeholder}} substitutes
      // to "" (matches v5 behavior on parse errors).
    }
  }

  let html = fs.readFileSync(indexPath, "utf8");
  const placeholders = templateJson.placeholders ?? {};

  const rules = input.textFormatting ?? [];
  const mcLabel = rules.length > 0 ? mcLabelFor(input.message) : "";

  for (const [name, ph] of Object.entries(placeholders)) {
    const binding = ph["binding-messagingmatrix"] ?? "";
    let value = binding ? lookupField(input.message, binding) : (ph.default ?? "");
    if (value === "" && ph.default && !binding) {
      value = ph.default;
    }
    if ((ph.type === "image" || ph.type === "video") && value) {
      const prefix = ph["path-messagingmatrix"] ?? "";
      if (prefix && !/^https?:\/\//i.test(value)) {
        value = prefix + value;
      }
    } else if (value && rules.length > 0) {
      value = applyFormatting(value, input.size, mcLabel, rules);
    }
    const re = new RegExp(`\\{\\{\\s*${escapeRegex(name)}\\s*\\}\\}`, "g");
    html = html.replace(re, value);
  }

  // Replace any remaining {{...}} placeholders with empty string so the output
  // is never littered with un-substituted curly tokens.
  html = html.replace(/\{\{\s*[^}]+\s*\}\}/g, "");

  if (input.inline) {
    html = inlineCss(html, dir, input.size);
    // The iframe preview uses `srcDoc=`, which gives the document no base URL,
    // so the template's relative refs (dynamic.content.js, thm.json, …) all
    // 404. Point them at /api/templates/<name>/ which already serves these.
    // Must be ABSOLUTE for srcDoc (a root-relative base falls back to the parent
    // origin's root). Only for inline mode — AdForm/POMS exports ship the files
    // alongside.
    html = injectBaseHref(
      html,
      `${input.baseOrigin ?? ""}/api/templates/${input.templateName}/`,
    );
  }

  if (input.skipAnimations) {
    html = injectSkipAnimations(html);
  }

  if (input.quietConsole) {
    html = injectQuietConsole(html);
  }

  return { html };
}

// Spec §3.6 — a rule applies only when its textOriginal equals the entire
// resolved value; substring hits never fire (the editor lists rules under a
// field with the same equality predicate, so whatever renders is visible
// there). A size-scoped rule beats a universal one, same as
// pickVariantForSize in feed-spans.ts.
function applyFormatting(
  value: string,
  size: string,
  mcLabel: string,
  rules: TextFormatting[],
): string {
  let universalFallback: string | null = null;
  for (const rule of rules) {
    if (rule.textOriginal !== value) continue;
    if (!matchesScope(rule, size, mcLabel)) continue;
    if (parseScope(rule.formattingScope) === null) {
      if (universalFallback === null) universalFallback = rule.textFormatted;
      continue;
    }
    return rule.textFormatted;
  }
  return universalFallback ?? value;
}

function injectBaseHref(html: string, href: string): string {
  const tag = `<base href="${href}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n${tag}`);
  }
  return tag + html;
}

// Skips animations + transitions for preview "skip animation" mode by forcing
// them to complete instantly (duration/delay 0) rather than disabling them —
// `animation: none` would freeze animate-in elements at their base state
// (e.g. `.animated #headlineWrapper { opacity: 0 }`), blanking all copy;
// a zero-duration run lands on the 100% keyframe and `fill-mode: forwards`
// holds it, so the banner shows its final resting frame.
// Inserted AFTER inline CSS so it wins on specificity. Cosmetic only —
// the rendered file shipped to AdForm is unaffected.
function injectSkipAnimations(html: string): string {
  const block = `<style data-mm6-skip-anim>
*,*::before,*::after{animation-duration:0s !important;animation-delay:0s !important;transition:none !important;}
</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return block + html;
}

// No-ops console.log/debug/info inside the preview iframe so the ad template's
// own verbose instrumentation (~40-50 lines/banner) doesn't reach the parent
// console — the grid renders hundreds of these same-origin srcDoc iframes.
// warn/error stay so genuine template failures still surface. Injected at the
// very start of <head> so it runs before any template script logs.
function injectQuietConsole(html: string): string {
  const block = `<script data-mm6-quiet-console>(function(){var n=function(){};console.log=n;console.debug=n;console.info=n;})();</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1\n${block}`);
  }
  return block + html;
}

function inlineCss(html: string, templateDir: string, size: string): string {
  const files = ["main.css", `${size}.css`];
  const parts: string[] = [];
  const inlined: string[] = [];
  for (const f of files) {
    const p = path.join(templateDir, f);
    if (fs.existsSync(p)) {
      parts.push(fs.readFileSync(p, "utf8"));
      inlined.push(f);
    }
  }
  if (parts.length === 0) return html;
  // Drop the now-redundant <link rel=stylesheet href="…"> for each file we just
  // inlined. In the srcDoc preview those links re-fetch the same CSS and (when
  // the base doesn't resolve) 404 — the biggest, most-repeated source of console
  // noise. The inlined <style> already carries their rules.
  for (const f of inlined) {
    const re = new RegExp(
      `<link\\b[^>]*\\bhref=["']${escapeRegex(f)}["'][^>]*>\\s*`,
      "gi",
    );
    html = html.replace(re, "");
  }
  const styleBlock = `<style data-mm6-inline>\n${parts.join("\n")}\n</style>`;
  // Insert just before </head>; if no </head>, prepend.
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }
  return styleBlock + html;
}
