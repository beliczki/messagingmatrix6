// Per-size span concatenation for feed-export columns marked as "Concat:".
//
// Port of mm5's applyTextFormattingSpans (messagingmatrix/src/utils/textFormatter.js).
// Given an originalText (the resolved value of a feed cell), the message's
// mcLabel, and the template's sizes, produce a string of the form:
//
//   <span class="text-default">orig</span>
//   <span class="text-300x250">variantA</span>
//   <span class="text-640x360">variantB</span>
//
// Variants come from text_formatting rules whose textOriginal === originalText
// AND whose mc-scope matches mcLabel. The size span set is the union of the
// template's sizes and any size mentioned in a matching rule's formattingScope
// (so a rule targeting an off-template size still emits its span — mm5 parity).
//
// No HTML escaping — same as mm5 and same as the render-time replacement at
// src/lib/render.ts (the rule author is trusted).

import type { TextFormatting } from "@/db/schema";
import { matchesScope, parseScope } from "@/lib/text-formatting-scope";

export function buildSizeSpans(
  originalText: string,
  templateSizes: string[],
  mcLabel: string,
  rules: TextFormatting[],
): string {
  if (!originalText) return "";

  const matchingRules = rules.filter(
    (r) =>
      r.textOriginal === originalText &&
      // mc-scope only — size scoping is handled per-size below.
      mcScopeMatches(r, mcLabel),
  );
  if (matchingRules.length === 0) return originalText;

  const sizes = unionSizes(templateSizes, matchingRules);

  let out = `<span class="text-default">${originalText}</span>`;
  for (const size of sizes) {
    const variant = pickVariantForSize(originalText, size, mcLabel, matchingRules);
    out += `<span class="text-${size}">${variant}</span>`;
  }
  return out;
}

function mcScopeMatches(rule: TextFormatting, mcLabel: string): boolean {
  const mcScope = parseScope(rule.formattingMcScope);
  if (mcScope === null) return true;
  return mcScope.includes(mcLabel.toLowerCase());
}

function unionSizes(
  templateSizes: string[],
  matchingRules: TextFormatting[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of templateSizes) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  for (const r of matchingRules) {
    const sizeScope = parseScope(r.formattingScope);
    if (sizeScope === null) continue; // universal — no extra sizes contributed
    for (const s of sizeScope) {
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function pickVariantForSize(
  originalText: string,
  size: string,
  mcLabel: string,
  matchingRules: TextFormatting[],
): string {
  // Prefer a size-scoped rule first, then a universal one, else original.
  let universalFallback: string | null = null;
  for (const r of matchingRules) {
    const sizeScope = parseScope(r.formattingScope);
    if (sizeScope === null) {
      if (universalFallback === null) universalFallback = r.textFormatted;
      continue;
    }
    if (sizeScope.includes(size.toLowerCase()) && matchesScope(r, size, mcLabel)) {
      return r.textFormatted;
    }
  }
  return universalFallback ?? originalText;
}
