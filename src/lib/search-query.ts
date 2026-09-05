export type SearchFields = {
  audience: string;
  topic: string;
  strategy: string;
  platform: string;
  mc: string;
  free: string;
};

export type MatchPredicate = (fields: SearchFields) => boolean;

type Term =
  | { kind: "free"; value: string }
  | { kind: "field"; field: keyof SearchFields; value: string };

const PREFIX_MAP: Record<string, keyof SearchFields> = {
  a: "audience",
  t: "topic",
  s: "strategy",
  p: "platform",
  mc: "mc",
};

const NARROWING_PREFIXES = new Set(["a", "t", "s", "p", "mc"]);

function tokenize(input: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let buf = "";
      while (j < input.length && input[j] !== '"') {
        buf += input[j];
        j++;
      }
      out.push(`"${buf}"`);
      i = j < input.length ? j + 1 : j;
      continue;
    }
    let j = i;
    let buf = "";
    while (j < input.length && input[j] !== " " && input[j] !== "\t" && input[j] !== "\n") {
      if (input[j] === '"') {
        let k = j + 1;
        let inner = "";
        while (k < input.length && input[k] !== '"') {
          inner += input[k];
          k++;
        }
        buf += `"${inner}"`;
        j = k < input.length ? k + 1 : k;
        continue;
      }
      buf += input[j];
      j++;
    }
    if (buf) out.push(buf);
    i = j;
  }
  return out;
}

function classifyToken(raw: string): Term | null {
  const colon = raw.indexOf(":");
  if (colon > 0 && raw[0] !== '"') {
    const prefix = raw.slice(0, colon).toLowerCase();
    const field = PREFIX_MAP[prefix];
    if (field) {
      const rawValue = raw.slice(colon + 1);
      const value = unquote(rawValue).toLowerCase();
      if (!value) return null;
      return { kind: "field", field, value };
    }
  }
  const value = unquote(raw).toLowerCase();
  if (!value) return null;
  return { kind: "free", value };
}

function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1);
  }
  return s;
}

const FREE_FIELDS: (keyof SearchFields)[] = [
  "audience",
  "topic",
  "strategy",
  "platform",
  "mc",
  "free",
];

// `mc:` is the one field where a raw substring match answers a different
// question than the one asked: `mc:21` also hits MC321 and MC210, so the grid
// fills with cards that have nothing to do with number 21 — and the answer
// looks right, because those cards are real. A query shaped like a card label
// is therefore anchored to the WHOLE number (digits may not continue on either
// side); a variant, when given, must match exactly, and when omitted every
// variant of that number matches. Anything else the caller packs into the mc
// field (the matrix appends the pmmid) keeps the substring behaviour.
const MC_LABEL_QUERY = /^(?:mc)?(\d+)([a-z]*)$/;

function mcMatches(value: string, field: string): boolean {
  const parsed = MC_LABEL_QUERY.exec(value);
  if (!parsed) return field.includes(value);
  const [, number, variant] = parsed;
  return new RegExp(`\\bmc${number}${variant || "[a-z]*"}\\b`).test(field);
}

function termMatches(term: Term, fields: SearchFields): boolean {
  if (term.kind === "field") {
    return term.field === "mc"
      ? mcMatches(term.value, fields.mc)
      : fields[term.field].includes(term.value);
  }
  for (const f of FREE_FIELDS) {
    if (fields[f].includes(term.value)) return true;
  }
  return false;
}

export function parseSearchQuery(input: string): MatchPredicate {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return () => true;

  const groups: Term[][] = [[]];
  for (const tok of tokens) {
    if (tok.toUpperCase() === "OR") {
      groups.push([]);
      continue;
    }
    const term = classifyToken(tok);
    if (term) groups[groups.length - 1]!.push(term);
  }

  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length === 0) return () => true;

  return (fields) => {
    for (const group of nonEmpty) {
      let allMatch = true;
      for (const term of group) {
        if (!termMatches(term, fields)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return true;
    }
    return false;
  };
}

export function emptySearchFields(): SearchFields {
  return { audience: "", topic: "", strategy: "", platform: "", mc: "", free: "" };
}

// Which grid axes a search narrows, for row/column pruning in the matrix.
// a/p/s describe an audience, so they prune the audience (column) axis; t
// describes a topic, so it prunes the topic (row) axis; mc identifies a single
// card, so it prunes both. Free text prunes neither — it only filters cell
// contents. This keeps p:/a:/t: from collapsing the full grid: only mc: does.
export function narrowingAxes(input: string): {
  audience: boolean;
  topic: boolean;
} {
  let audience = false;
  let topic = false;
  for (const tok of tokenize(input.trim())) {
    if (tok[0] === '"') continue;
    const colon = tok.indexOf(":");
    if (colon <= 0) continue;
    if (tok.slice(colon + 1).length === 0) continue;
    const prefix = tok.slice(0, colon).toLowerCase();
    if (prefix === "a" || prefix === "p" || prefix === "s") audience = true;
    else if (prefix === "t") topic = true;
    else if (prefix === "mc") {
      audience = true;
      topic = true;
    }
  }
  return { audience, topic };
}

export function hasNarrowingPrefix(input: string): boolean {
  const tokens = tokenize(input.trim());
  for (const tok of tokens) {
    if (tok[0] === '"') continue;
    const colon = tok.indexOf(":");
    if (colon <= 0) continue;
    const prefix = tok.slice(0, colon).toLowerCase();
    if (NARROWING_PREFIXES.has(prefix) && tok.slice(colon + 1).length > 0) {
      return true;
    }
  }
  return false;
}
