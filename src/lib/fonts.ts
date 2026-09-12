// The UI faces the app ships (src/app/fonts.css) and the stack each one falls
// back through. One source: the Design tab's dropdown, the server-rendered
// --font-base (lib/branding.ts) and the live preview all read it from here —
// before this, the stack was assembled from a template literal in two places
// that had already drifted apart in spirit (one of them named a font nothing
// loaded).

export type FontOption = {
  /** Stored in lookAndFeel.fontFamily. */
  value: string;
  label: string;
  /** Full CSS font-family value for --font-base. */
  stack: string;
};

const FALLBACK = `system-ui, -apple-system, "Segoe UI", sans-serif`;

export const FONT_OPTIONS: FontOption[] = [
  { value: "Inter", label: "Inter", stack: `"Inter", ${FALLBACK}` },
  { value: "Poppins", label: "Poppins", stack: `"Poppins", ${FALLBACK}` },
  { value: "TeleNeo", label: "TeleNeo", stack: `"TeleNeo", ${FALLBACK}` },
  { value: "system-ui", label: "System default", stack: FALLBACK },
];

/**
 * Stack for a stored fontFamily. An unknown value — a face typed by hand into
 * the old free-text field — keeps working exactly as it did: named first, then
 * the same fallbacks. It is not silently rewritten to Inter.
 */
export function fontStack(family: string): string {
  const known = FONT_OPTIONS.find((f) => f.value === family);
  if (known) return known.stack;
  const trimmed = family.trim();
  if (!trimmed) return FALLBACK;
  return `"${trimmed}", ${FALLBACK}`;
}
