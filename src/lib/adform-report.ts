// Parse a standalone AdForm "Creative custom report" XLSX (Stats & Reports →
// Custom Reports) into message-level performance rows for the `monitoring`
// table. This is a DIFFERENT shape from the feed snapshot in adform-snapshot.ts:
// it is a performance export, keyword/banner-level (~85k rows/month), with the
// PMMID embedded in the "Banner/Adgroups" column.
//
// Two things this module owns:
//   1. Robust PMMID extraction from "Banner/Adgroups" (two on-the-wire formats).
//   2. Aggregation to one row per (platform, message-key) for the whole period
//      — the matrix only needs message-level numbers, never per-keyword.
//
// Columns are resolved BY HEADER NAME, so adding/removing/reordering metrics in
// the AdForm report builder (e.g. adding "Rendered Impressions") does not break
// the parser.

import xlsx from "node-xlsx";

export type MonitoringRow = {
  platform: string;
  scope: string | null;
  pmmid: string;
  size: string;
  audienceKey: string;
  topicKey: string;
  mcNumber: number;
  mcVariant: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
};

export type AdformReportParseResult = {
  periodFrom: string;
  periodTo: string;
  rows: MonitoringRow[];
  totalDataRows: number;
  skipped: number;
};

// PMMID scope prefix (the part before "-s_") encodes the buying platform/vendor,
// e.g. "p_adform", "p_dv360", "p_googleads_googlesearchnetwork",
// "p_meta_facebook", "p_infinety_avpackage". The first underscore-segment after
// "p_" is the platform; the rest is the vendor/package. A few vendors register
// long legal names as the segment, so we normalize the common ones.
const PLATFORM_ALIASES: Record<string, string> = {
  googleads: "googleads",
  dv360: "dv360",
  adform: "adform",
  meta: "meta",
  telex: "telex",
  flex: "flex",
  infinety: "infinety",
  indamedia: "indamedia",
  datainnovation: "datainnovation",
  datainnovationkft: "datainnovation",
  tiktoktechnologiesuklimited: "tiktok",
  tiktok: "tiktok",
  wppmedianexusmediasolutions: "wppnexus",
  wppmedianexusmediasolutionsflex: "wppnexus",
};

export function normalizePlatform(scope: string | null): string {
  if (!scope) return "unknown";
  const seg = scope.replace(/^p_/, "").split("_")[0] || "unknown";
  return PLATFORM_ALIASES[seg] ?? seg;
}

export type ParsedPmmid = {
  scope: string | null;
  audienceKey: string;
  topicKey: string;
  mcNumber: number;
  mcVariant: string;
};

// Extract the PMMID token from a "Banner/Adgroups" cell. Two formats seen:
//   display/Adform: "<Campaign> - <BannerName> - p_adform-s_pro-a_…-m_…-…"
//   search/richmedia: "text!text!00!1x1!pmmid=p_googleads…-v_0!v11"
// Extract the creative size from a "Banner/Adgroups" cell. The size token
// (e.g. "300x250", "1x1") sits in the campaign/banner-name part, before the
// PMMID, so the first NxN match is the creative size. "" when none is found.
export function extractSize(bannerAdgroups: string): string {
  if (!bannerAdgroups) return "";
  const m = bannerAdgroups.match(/(\d{1,4})x(\d{1,4})/);
  return m ? `${m[1]}x${m[2]}` : "";
}

export function extractPmmidToken(bannerAdgroups: string): string | null {
  if (!bannerAdgroups) return null;
  const eq = bannerAdgroups.match(/pmmid=([^!]+)/);
  if (eq) return eq[1].trim();
  for (const part of bannerAdgroups.split(" - ")) {
    const t = part.trim();
    if (/^p_[^ ]*-s_/.test(t)) return t;
  }
  return null;
}

// Parse a v6 PMMID into its message-key parts. Audience and topic keys can
// themselves contain hyphens (e.g. "VAL_wlfin-findsk"), so we locate every
// segment marker by position and slice each field up to the NEXT marker rather
// than assuming a fixed field order or a hyphen-free body. Returns null unless
// a numeric "-m_" (MC number) and a "-v_" (variant) are both present — rows
// without them are DEFAULT/brand rows that map to no matrix message.
export function parsePmmid(pmmid: string): ParsedPmmid | null {
  // strip search-format trailing "!v11" etc.
  const core = pmmid.split("!")[0];
  const scope = core.includes("-s_") ? core.slice(0, core.indexOf("-s_")) : null;

  const markers = ["-a_", "-m_", "-t_", "-v_", "-n_"] as const;
  const found = markers
    .map((m) => ({ m, idx: core.indexOf(m) }))
    .filter((x) => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx);

  const field = (marker: string): string | null => {
    const self = found.find((f) => f.m === marker);
    if (!self) return null;
    const start = self.idx + marker.length;
    const next = found.find((f) => f.idx > self.idx);
    const end = next ? next.idx : core.length;
    return core.slice(start, end);
  };

  const audienceKey = field("-a_");
  const topicKey = field("-t_");
  const rawNum = field("-m_");
  const variant = field("-v_");
  if (!audienceKey || !topicKey || !rawNum || !variant) return null;

  const mcNumber = Number(rawNum);
  if (!Number.isInteger(mcNumber)) return null;

  return { scope, audienceKey, topicKey, mcNumber, mcVariant: variant };
}

// Reduce a trafficked variant to its single-letter creative variant when it
// carries a descriptive token (e.g. "hitelvalaszto_a" → "a", "a_calc_auto" →
// "a") — the matrix stores the bare letter while campaigns are often trafficked
// with a labelled variant. Only a leading or trailing underscore-separated
// single-letter segment qualifies; anything else is returned lowercased but
// otherwise unchanged, so multi-letter variants like "na" never collapse.
export function variantLetter(variant: string): string {
  const v = variant.toLowerCase();
  const parts = v.split("_");
  if (parts.length > 1) {
    if (/^[a-z]$/.test(parts[0])) return parts[0];
    const last = parts[parts.length - 1];
    if (/^[a-z]$/.test(last)) return last;
  }
  return v;
}

export type MessageKeyRow = {
  id: number;
  number: number;
  variant: string;
  audience: string;
  topic: string;
};

export type MatchLevel = "exact" | "family" | "family_known";

export type MessageMatch = {
  messageId: number | null;
  matchLevel: MatchLevel | null;
};

// Tiered, conservative resolver from a parsed report key to a matrix message:
//   1. "exact"        — case-insensitive equality on (number, variant,
//                       audience, topic);
//   2. "family"       — (number, variantLetter) resolves to exactly ONE
//                       message, so the link is unambiguous even though the
//                       trafficked audience/topic named a different cell;
//   3. "family_known" — the family exists but fans out to several cells; no
//                       single message can be linked, messageId stays null.
// Product-only or size-only fallbacks are deliberately excluded — the 2026Q2
// creative match study showed evidence-free associations must not count.
export function buildMessageResolver(
  rows: MessageKeyRow[],
): (
  number: number,
  variant: string,
  audience: string,
  topic: string,
) => MessageMatch {
  const exact = new Map<string, number>();
  const family = new Map<string, number[]>();
  for (const m of rows) {
    exact.set(
      `${m.number}|${m.variant}|${m.audience}|${m.topic}`.toLowerCase(),
      m.id,
    );
    const fk = `${m.number}|${variantLetter(m.variant)}`;
    const ids = family.get(fk);
    if (ids) ids.push(m.id);
    else family.set(fk, [m.id]);
  }
  return (number, variant, audience, topic) => {
    const ex = exact.get(
      `${number}|${variant}|${audience}|${topic}`.toLowerCase(),
    );
    if (ex !== undefined) return { messageId: ex, matchLevel: "exact" };
    const fam = family.get(`${number}|${variantLetter(variant)}`);
    if (!fam) return { messageId: null, matchLevel: null };
    if (fam.length === 1) return { messageId: fam[0], matchLevel: "family" };
    return { messageId: null, matchLevel: "family_known" };
  };
}

export type ProductRule = { keyword: string; product: string };

// Resolve a product code for a monitoring row. Priority:
//  1. the row's audience product (matrix-authoritative) when known & non-null —
//     covers matched rows and unmatched rows whose audience still exists;
//  2. else the first keyword rule whose (lowercased) keyword is a substring of
//     the topic key or the PMMID — the Settings → Structure → Monitoring rules;
//  3. else null.
export function resolveProduct(
  audienceKey: string,
  topicKey: string,
  pmmid: string | null,
  audienceProduct: Map<string, string | null>,
  rules: ProductRule[],
): string | null {
  const fromAudience = audienceProduct.get(audienceKey);
  if (fromAudience) return fromAudience;
  const hay = `${topicKey} ${pmmid ?? ""}`.toLowerCase();
  for (const r of rules) {
    const kw = r.keyword.trim().toLowerCase();
    if (kw && hay.includes(kw)) return r.product;
  }
  return null;
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

function cellToNumber(cell: unknown): number {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : 0;
  if (typeof cell === "string") {
    const n = Number(cell.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// Find the header row index in a sheet — the first row that carries the
// "Banner/Adgroups" column (the report prepends a "Summary"/"Table" label row).
function findHeader(data: unknown[][]): number {
  for (let i = 0; i < data.length; i += 1) {
    const row = data[i];
    if (row && row.some((c) => cellToString(c).trim() === "Banner/Adgroups")) {
      return i;
    }
  }
  return -1;
}

// Read the value that follows a label cell on a Front Page row. AdForm's own
// export leaves column A empty (label in B, value in C), but reports rebuilt by
// other tooling write the label in A — so the label is located wherever it sits
// and the value is the next non-empty cell after it, never a fixed index.
function valueAfterLabel(row: unknown[], label: RegExp): string | null {
  for (let i = 0; i < row.length; i += 1) {
    if (!label.test(cellToString(row[i]).trim())) continue;
    for (let j = i + 1; j < row.length; j += 1) {
      const v = cellToString(row[j]).trim();
      if (v) return v;
    }
    return "";
  }
  return null;
}

function readPeriod(sheets: { name: string; data: unknown[][] }[]): {
  from: string;
  to: string;
} {
  const front = sheets.find((s) => /front\s*page/i.test(s.name));
  let from = "";
  let to = "";
  if (front) {
    for (const row of front.data) {
      if (!row) continue;
      const f = valueAfterLabel(row, /^reporting period from$/i);
      if (f !== null) from = f;
      const t = valueAfterLabel(row, /^reporting period to$/i);
      if (t !== null) to = t;
    }
  }
  return { from, to };
}

export function parseAdformReport(buffer: Buffer): AdformReportParseResult {
  const sheets = xlsx.parse(buffer) as { name: string; data: unknown[][] }[];
  if (sheets.length === 0) {
    throw new Error("AdForm report contains no sheets");
  }

  const { from: periodFrom, to: periodTo } = readPeriod(sheets);
  if (!periodFrom || !periodTo) {
    throw new Error(
      "Could not read Reporting Period From/To from the Front Page sheet",
    );
  }

  // The data sheet is the one whose header row has "Banner/Adgroups".
  let dataSheet: { name: string; data: unknown[][] } | null = null;
  let headerIdx = -1;
  for (const s of sheets) {
    const idx = findHeader(s.data);
    if (idx >= 0) {
      dataSheet = s;
      headerIdx = idx;
      break;
    }
  }
  if (!dataSheet) {
    throw new Error('No data sheet with a "Banner/Adgroups" column found');
  }

  const header = dataSheet.data[headerIdx].map((c) => cellToString(c).trim());
  const col = (name: string): number => header.indexOf(name);
  const bagIdx = col("Banner/Adgroups");
  const imprIdx = col("Rendered Impressions");
  const clicksIdx = col("Clicks");
  const costIdx = col("Cost");
  const convIdx = col("Conversions");

  type Agg = MonitoringRow;
  const byKey = new Map<string, Agg>();
  let totalDataRows = 0;
  let skipped = 0;

  for (let i = headerIdx + 1; i < dataSheet.data.length; i += 1) {
    const raw = dataSheet.data[i];
    if (!raw || raw.every((c) => c === null || c === undefined || c === "")) {
      continue;
    }
    totalDataRows += 1;

    const bag = cellToString(raw[bagIdx]);
    const token = extractPmmidToken(bag);
    const parsed = token ? parsePmmid(token) : null;
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const platform = normalizePlatform(parsed.scope);
    const size = extractSize(bag);
    const key = [
      platform,
      parsed.audienceKey,
      parsed.mcNumber,
      parsed.topicKey,
      parsed.mcVariant,
      size,
    ].join("|");

    const impressions = imprIdx >= 0 ? cellToNumber(raw[imprIdx]) : 0;
    const clicks = clicksIdx >= 0 ? cellToNumber(raw[clicksIdx]) : 0;
    const cost = costIdx >= 0 ? cellToNumber(raw[costIdx]) : 0;
    const conversions = convIdx >= 0 ? cellToNumber(raw[convIdx]) : 0;

    const existing = byKey.get(key);
    if (existing) {
      existing.impressions += impressions;
      existing.clicks += clicks;
      existing.cost += cost;
      existing.conversions += conversions;
    } else {
      byKey.set(key, {
        platform,
        scope: parsed.scope,
        pmmid: token!,
        size,
        audienceKey: parsed.audienceKey,
        topicKey: parsed.topicKey,
        mcNumber: parsed.mcNumber,
        mcVariant: parsed.mcVariant,
        impressions,
        clicks,
        cost,
        conversions,
        ctr: null,
      });
    }
  }

  const rows = [...byKey.values()].map((r) => ({
    ...r,
    ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
  }));

  return { periodFrom, periodTo, rows, totalDataRows, skipped };
}
