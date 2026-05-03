// Pure scope-matching helpers for text-formatting rules. Lives in its own
// module — separate from src/lib/entities/text-formatting.ts which pulls in
// the DB layer (better-sqlite3, native-only) — so that client bundles can
// import these helpers transitively (e.g. via patterns.ts → feed-spans.ts)
// without dragging Node-only deps into the browser.
//
// Spec §3.6.

import type { TextFormatting } from "@/db/schema";

/**
 * Parse a scope CSV ("300x250, 640x360" or "MC1a") into a normalized list of
 * lowercase tokens. Returns null when the scope is missing or empty —
 * meaning the rule applies universally (no scope filter).
 */
export function parseScope(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function matchesScope(
  rule: TextFormatting,
  size: string,
  mcLabel: string,
): boolean {
  const sizeScope = parseScope(rule.formattingScope);
  if (sizeScope !== null && !sizeScope.includes(size.toLowerCase())) {
    return false;
  }
  const mcScope = parseScope(rule.formattingMcScope);
  if (mcScope !== null && !mcScope.includes(mcLabel.toLowerCase())) {
    return false;
  }
  return true;
}
