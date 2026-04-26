// Pattern evaluator. v5-locked behavior. Spec §14.
// Cases are golden in tests/fixtures/v5/pattern-evaluator/cases.json.
//
// Syntax:
//   {{var}}                       — variable substitution
//   {{Var}}                       — case-insensitive lookup
//   {{x|upper}}                   — modifier
//   {{x|noext|upper}}             — chained modifiers
//   {{arr[key].field}}            — array-by-key access
//   {{arr[var].field}}            — array key resolved from another var
//   {{obj.field}}                 — object access (case-insensitive incl. snake_case)
//   {{var}}=value?then:else       — conditional (top-level expression)
//
// Missing values resolve to "". Unknown modifiers pass through unchanged.
// Numbers coerce to string; null/undefined → "".

export type PatternContext = Record<string, unknown>;

const MODS: Record<string, (s: string) => string> = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  trim: (s) => s.trim(),
  noext: (s) => {
    const dot = s.lastIndexOf(".");
    return dot > 0 ? s.slice(0, dot) : s;
  },
};

// Normalize a key for fuzzy matching: lowercase, strip non-alphanumeric.
// Allows {{message.LandingUrl}} to match `landing_url`.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findKey(obj: Record<string, unknown>, name: string): string | null {
  if (name in obj) return name;
  const target = normalize(name);
  for (const k of Object.keys(obj)) {
    if (normalize(k) === target) return k;
  }
  return null;
}

function coerceString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  return "";
}

// Resolve a path like "audiences[aud1].strategy" or "message.headline"
// against the context. Returns "" for any missing segment.
function resolvePath(path: string, ctx: PatternContext): string {
  // First segment may be name or name[key]
  const segments = path.split(".");
  let current: unknown = ctx;

  for (let i = 0; i < segments.length; i++) {
    if (current === null || current === undefined) return "";
    const seg = segments[i];

    // Array-by-key: name[key]
    const arrMatch = seg.match(/^([^\[]+)\[([^\]]+)\]$/);
    if (arrMatch) {
      const arrName = arrMatch[1];
      let lookupKey = arrMatch[2];

      if (typeof current !== "object") return "";
      const obj = current as Record<string, unknown>;
      const realName = findKey(obj, arrName);
      if (!realName) return "";
      const arr = obj[realName];
      if (!Array.isArray(arr)) return "";

      // The lookup key may itself be a var name in the context.
      const ctxResolved = ctx[lookupKey];
      if (typeof ctxResolved === "string") {
        lookupKey = ctxResolved;
      } else {
        const k = findKey(ctx as Record<string, unknown>, lookupKey);
        if (k && typeof ctx[k] === "string") lookupKey = ctx[k] as string;
      }

      const item = arr.find(
        (it) =>
          it &&
          typeof it === "object" &&
          (it as Record<string, unknown>).key === lookupKey,
      );
      current = item ?? null;
      continue;
    }

    // Plain field access (case-insensitive)
    if (typeof current !== "object") return "";
    const obj = current as Record<string, unknown>;
    const real = findKey(obj, seg);
    if (!real) return "";
    current = obj[real];
  }

  return coerceString(current);
}

function evalSingleVar(expr: string, ctx: PatternContext): string {
  // Split modifiers
  const parts = expr.split("|").map((p) => p.trim());
  const path = parts[0];
  const mods = parts.slice(1);

  let value = resolvePath(path, ctx);
  for (const m of mods) {
    const fn = MODS[m];
    if (fn) value = fn(value);
    // unknown modifier: pass through unchanged (matches v5)
  }
  return value;
}

// {{var}}=value?then:else
const COND_RE = /^\s*\{\{([^}]+)\}\}=([^?]*)\?([^:]*):(.*)$/;

export function evaluatePattern(
  pattern: string | null | undefined,
  ctx: PatternContext = {},
): string {
  if (pattern === null || pattern === undefined || pattern === "") return "";

  // Top-level conditional
  const cond = pattern.match(COND_RE);
  if (cond) {
    const [, varExpr, expected, thenBranch, elseBranch] = cond;
    const value = evalSingleVar(varExpr.trim(), ctx);
    return value === expected ? thenBranch : elseBranch;
  }

  // {{...}} substitution
  return pattern.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) =>
    evalSingleVar(expr, ctx),
  );
}
