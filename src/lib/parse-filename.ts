// Filename → metadata parser. Spec §6.4 + §6.9.
// Driven by config.creativeParsingRules per-client (Spec §17.4).
//
// Rule shapes (any field key may carry one):
//   { type: "fixed",      value: "Erste" }
//   { type: "segment",    index: 0, separator: "_" }
//   { type: "after_segment", index: 2, separator: "_" }     // joined remainder
//   { type: "last_segment", separator: "_" }                // last before ext
//   { type: "extension_type" }                              // .png→image, .mp4→video, …
//   { type: "extension" }                                   // just ".png" → "png"
//   { type: "pattern",    pattern: "MC(\\d+)([a-z])", group: 1 }
//
// Returns parsed fields + a list of warnings for fields the rules failed on.

export type ParseRule =
  | { type: "fixed"; value: string }
  | { type: "segment"; index: number; separator?: string }
  | { type: "after_segment"; index: number; separator?: string }
  | { type: "last_segment"; separator?: string }
  | { type: "extension_type" }
  | { type: "extension" }
  | { type: "pattern"; pattern: string; group?: number };

export type ParseRules = Record<string, ParseRule>;

export type ParsedFilename = {
  fields: Record<string, string>;
  warnings: string[];
};

const EXT_TYPE: Record<string, string> = {
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".mp4": "video",
  ".mov": "video",
  ".webm": "video",
  ".html": "html",
  ".zip": "html",
  ".pdf": "pdf",
};

function basename(filename: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  return slash >= 0 ? filename.slice(slash + 1) : filename;
}

function stripExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(0, i) : filename;
}

function getExt(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i > 0 ? filename.slice(i).toLowerCase() : "";
}

function applyRule(filename: string, rule: ParseRule): string | null {
  const base = basename(filename);
  const stem = stripExt(base);
  const ext = getExt(base);

  switch (rule.type) {
    case "fixed":
      return rule.value;
    case "extension":
      return ext.replace(/^\./, "");
    case "extension_type":
      return EXT_TYPE[ext] ?? null;
    case "segment": {
      const sep = rule.separator ?? "_";
      const parts = stem.split(sep);
      if (rule.index < 0 || rule.index >= parts.length) return null;
      return parts[rule.index] || null;
    }
    case "after_segment": {
      const sep = rule.separator ?? "_";
      const parts = stem.split(sep);
      if (rule.index < 0 || rule.index >= parts.length) return null;
      return parts.slice(rule.index).join(sep) || null;
    }
    case "last_segment": {
      const sep = rule.separator ?? "_";
      const parts = stem.split(sep);
      return parts[parts.length - 1] || null;
    }
    case "pattern": {
      try {
        const re = new RegExp(rule.pattern);
        const m = base.match(re);
        if (!m) return null;
        return m[rule.group ?? 1] ?? null;
      } catch {
        return null;
      }
    }
  }
}

/**
 * What a filename's extension says it is, using the same map the importer
 * classifies uploads with. Returns null for an extension the map does not know.
 *
 * Callers that only hold a filename need this — a stored creative is just a
 * name until it is fetched, and rendering an .mp4 into an `<img>` shows the alt
 * text on a checkerboard instead of the video.
 */
export function mediaKindFromFilename(filename: string): string | null {
  const name = basename(filename);
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TYPE[name.slice(dot).toLowerCase()] ?? null;
}

export function parseFilename(
  filename: string,
  rules: ParseRules,
): ParsedFilename {
  const fields: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [field, rule] of Object.entries(rules)) {
    const value = applyRule(filename, rule);
    if (value !== null && value !== "") {
      fields[field] = value;
    } else {
      warnings.push(`${field}: rule did not match`);
    }
  }
  return { fields, warnings };
}
