// Template render. Spec §4.6 + §14.
// v5 source-of-truth: server.js populateTemplate() lines 1682-1737.
//
// Algorithm:
//   1. Load templates/{name}/index.html.
//   2. For each placeholder in template.json:
//      - Resolve value from message via binding-messagingmatrix.
//      - For image/video types, prepend path-messagingmatrix.
//      - Substitute {{placeholder}} occurrences with the resolved value.
//   3. Apply matching text_formatting rules (Spec §3.6) — replace
//      `text_original` with `text_formatted` in the body when
//      formatting_scope and formatting_mc_scope both match.
//
// We don't include the size CSS by default — v5's preview-iframe approach
// references size CSS via a relative <link>. Callers that want fully inlined
// HTML (share gallery / export) opt in via { inline: true }.

import fs from "node:fs";
import path from "node:path";
import { matchesScope } from "@/lib/entities/text-formatting";
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

function lookupField(
  message: Record<string, unknown>,
  binding: string,
): string {
  if (!binding) return "";
  const target = normalize(binding);
  for (const [k, v] of Object.entries(message)) {
    if (normalize(k) === target) {
      if (v === null || v === undefined) return "";
      return String(v);
    }
  }
  return "";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mcLabelFor(message: Record<string, unknown>): string {
  const n = message.number ?? message.Number;
  const v = message.variant ?? message.Variant;
  if (n === null || n === undefined || !v) return "";
  return `MC${n}${v}`;
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
    }
    const re = new RegExp(`\\{\\{\\s*${escapeRegex(name)}\\s*\\}\\}`, "g");
    html = html.replace(re, value);
  }

  // Replace any remaining {{...}} placeholders with empty string so the output
  // is never littered with un-substituted curly tokens.
  html = html.replace(/\{\{\s*[^}]+\s*\}\}/g, "");

  // Apply text-formatting (Spec §3.6).
  if (input.textFormatting && input.textFormatting.length > 0) {
    const mcLabel = mcLabelFor(input.message);
    for (const rule of input.textFormatting) {
      if (!matchesScope(rule, input.size, mcLabel)) continue;
      const re = new RegExp(escapeRegex(rule.textOriginal), "g");
      html = html.replace(re, rule.textFormatted);
    }
  }

  if (input.inline) {
    html = inlineCss(html, dir, input.size);
  }

  if (input.skipAnimations) {
    html = injectSkipAnimations(html);
  }

  return { html };
}

// Strips animations + transitions for preview "skip animation" mode.
// Inserted AFTER inline CSS so it wins on specificity. Cosmetic only —
// the rendered file shipped to AdForm is unaffected.
function injectSkipAnimations(html: string): string {
  const block = `<style data-mm6-skip-anim>
*,*::before,*::after{animation:none !important;transition:none !important;}
</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return block + html;
}

function inlineCss(html: string, templateDir: string, size: string): string {
  const sizeCssPath = path.join(templateDir, `${size}.css`);
  const mainCssPath = path.join(templateDir, "main.css");
  const parts: string[] = [];
  if (fs.existsSync(mainCssPath)) {
    parts.push(fs.readFileSync(mainCssPath, "utf8"));
  }
  if (fs.existsSync(sizeCssPath)) {
    parts.push(fs.readFileSync(sizeCssPath, "utf8"));
  }
  if (parts.length === 0) return html;
  const styleBlock = `<style data-mm6-inline>\n${parts.join("\n")}\n</style>`;
  // Insert just before </head>; if no </head>, prepend.
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }
  return styleBlock + html;
}
