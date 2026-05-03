// AdForm-aware feed export builder, diff, and version-decision logic.
// Spec §6.2 + §6.X (Feeds menupoint). Anchored to v5 transforms but rebuilt
// against v6 patterns.ts + feed-patterns.ts so feedStructure / patterns.feed
// drive the column set 1:1 with the in-app Feed view.

import { and, eq } from "drizzle-orm";
import xlsx from "node-xlsx";

import { db } from "@/db";
import {
  audiences as audiencesTable,
  config as configTable,
  feedExports,
  messages as messagesTable,
  topics as topicsTable,
  type Audience as DbAudience,
  type FeedExport,
  type Message as DbMessage,
  type TextFormatting,
  type Topic as DbTopic,
} from "@/db/schema";
import { evaluatePattern, FORMATTING_CTX_KEYS } from "@/lib/patterns";
import {
  parseFeedColumns,
  resolveFeedPattern,
} from "@/lib/feed-patterns";
import { listTextFormatting } from "@/lib/entities/text-formatting";
import { mcLabelFor } from "@/lib/mc-label";
import { readTemplate } from "@/lib/templates";

const MAX_ROWS_PER_FEED = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Types

export type FeedRow = Record<string, string>;

export type FeedRowSet = {
  columns: string[];
  rows: FeedRow[];
  // Parallel to rows. The DEFAULT row's slot is -1 (no real message id).
  messageIds: number[];
  defaultRowIndex: number;
};

export type FeedDiff = {
  added: number[];          // indexes into next.rows
  removed: number[];        // indexes into prev.rows
  changed: Array<{
    prevIndex: number;
    nextIndex: number;
    fields: string[];       // column names whose value differs
  }>;
  unchangedCount: number;
};

export type VersionDecision = {
  feedVersion: number;
  action: "first" | "append" | "new_version";
  reasons: string[];        // human-readable triggers
};

export type BuildOptions = {
  clientId: number;
  product: string;
  defaultMessageId: number | null;
  forceNewVersion?: boolean;
  /**
   * If provided, restrict the export's row set to messages whose id is in
   * this list (intersected with product + ACTIVE + carry-forward rules).
   * Mirrors the user's matrix filter so the export reflects what they see.
   */
  messageIds?: number[] | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Config readers

type Patterns = {
  feed?: Record<string, string>;
  [k: string]: unknown;
};

function readConfigValue(clientId: number, key: string): unknown {
  const row = db
    .select()
    .from(configTable)
    .where(and(eq(configTable.clientId, clientId), eq(configTable.key, key)))
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function readFeedStructure(clientId: number): string {
  const v = readConfigValue(clientId, "feedStructure");
  return typeof v === "string" ? v : "";
}

function readFeedPatterns(clientId: number): Record<string, string> {
  const p = readConfigValue(clientId, "patterns") as Patterns | null;
  return p?.feed ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern context — same shape FeedView builds, kept symmetric so the
// in-app preview and the exported file render identical strings.

function buildContext(
  m: DbMessage,
  aud: DbAudience | null,
  top: DbTopic | null,
  audiences: DbAudience[],
  topics: DbTopic[],
  audienceKeyOverride?: string,
): Record<string, unknown> {
  return {
    ...m,
    audience_key: audienceKeyOverride ?? m.audience,
    topic_key: m.topic,
    audience_name: aud?.name ?? "",
    topic_name: top?.name ?? "",
    product: aud?.product ?? top?.product ?? "",
    strategy: aud?.strategy ?? "",
    device: aud?.device ?? "",
    targeting_type: aud?.targetingType ?? "",
    audiences,
    topics,
    // v5-style aliases. The pattern evaluator's normalize() collapses to
    // alphanumeric so {{Audience_Key}} hits audience_key, but we provide the
    // exact-cased keys too so explicit lookups don't depend on normalization.
    Audience_Key: audienceKeyOverride ?? m.audience,
    Topic_Key: m.topic,
  };
}

function evaluateRow(
  m: DbMessage,
  columns: string[],
  feedPatterns: Record<string, string>,
  ctx: Record<string, unknown>,
): FeedRow {
  const out: FeedRow = {};
  for (const col of columns) {
    const pattern = resolveFeedPattern(col, feedPatterns);
    let v = evaluatePattern(pattern, ctx);
    if (v) v = v.replace(/[\r\n]+/g, " ").trim();
    out[col] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT row construction
//
// v5 derives the DEFAULT row from one chosen message and rewrites three
// things: PMMID/ReportingLabel get -a_<aud>- → -a_DEFAULT-, the lineitem id
// suffix -l_<n> → -l_ANY, and advert_id flips to "1". We re-evaluate columns
// whose pattern actually references audience_key (so feeds that don't bake the
// audience into a label don't get a phantom rewrite).

function applyDefaultLabelTransforms(value: string): string {
  let v = value;
  v = v.replace(/(-a_)[^-]*(-m_)/, "$1DEFAULT$2");
  v = v.replace(/-l_\d+$/, "-l_ANY");
  return v;
}

function patternUsesAudienceKey(pattern: string): boolean {
  // Cheap detector: we just need to know if {{Audience_Key}} (any case) and
  // {{audience_key}} appear. Modifiers / array access don't matter.
  return /\{\{\s*[Aa]udience_[Kk]ey\s*[|}]/.test(pattern);
}

function findColumnByCleanName(
  columns: string[],
  cleanLower: string,
): string | null {
  for (const col of columns) {
    const lower = col.replace(/^[^:]+:/, "").toLowerCase();
    if (lower === cleanLower) return col;
  }
  return null;
}

function buildDefaultRow(
  base: FeedRow,
  defaultMessage: DbMessage,
  aud: DbAudience | null,
  top: DbTopic | null,
  audiences: DbAudience[],
  topics: DbTopic[],
  columns: string[],
  feedPatterns: Record<string, string>,
  formattingCtxOverlay: Record<string, unknown> | null,
): FeedRow {
  const defaultRow: FeedRow = { ...base };
  const ctx = buildContext(defaultMessage, aud, top, audiences, topics, "default");
  if (formattingCtxOverlay) Object.assign(ctx, formattingCtxOverlay);
  for (const col of columns) {
    const pattern = resolveFeedPattern(col, feedPatterns);
    if (patternUsesAudienceKey(pattern)) {
      let v = evaluatePattern(pattern, ctx);
      if (v) v = v.replace(/[\r\n]+/g, " ").trim();
      defaultRow[col] = v;
    }
  }

  const advertIdCol = findColumnByCleanName(columns, "advert_id");
  if (advertIdCol) defaultRow[advertIdCol] = "1";

  const isDefaultCol = findColumnByCleanName(columns, "isdefault");
  if (isDefaultCol) defaultRow[isDefaultCol] = "TRUE";

  for (const lblCol of [
    findColumnByCleanName(columns, "pmmid"),
    findColumnByCleanName(columns, "reportinglabel"),
  ]) {
    if (lblCol && defaultRow[lblCol]) {
      defaultRow[lblCol] = applyDefaultLabelTransforms(defaultRow[lblCol]);
    }
  }

  // AdForm-allocated / scheduling fields don't apply to the DEFAULT row —
  // AdForm ignores them on the default anyway, so emit empty cells instead of
  // carrying the chosen-message values forward (which looks misleading).
  for (const cleanName of ["adfplaid", "datefrom", "dateto"]) {
    const col = findColumnByCleanName(columns, cleanName);
    if (col) defaultRow[col] = "";
  }

  return defaultRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live snapshot lookup

export function findLiveExport(
  clientId: number,
  product: string,
): FeedExport | null {
  // Latest *uploaded* export for this (client, product), regardless of version.
  const rows = db
    .select()
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, clientId),
        eq(feedExports.product, product),
      ),
    )
    .all();
  const uploaded = rows
    .filter((r) => r.uploadedToAdformAt)
    .sort((a, b) =>
      (b.uploadedToAdformAt ?? "").localeCompare(a.uploadedToAdformAt ?? ""),
    );
  return uploaded[0] ?? null;
}

function readLiveMessageIds(live: FeedExport | null): number[] {
  if (!live) return [];
  try {
    const payload = JSON.parse(live.payloadJson) as { messageIds?: number[] };
    return (payload.messageIds ?? []).filter((id) => id !== -1);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build row set

export function buildFeedRowSet(opts: BuildOptions): {
  rowSet: FeedRowSet;
  defaultMessage: DbMessage | null;
  liveExport: FeedExport | null;
} {
  const { clientId, product, defaultMessageId } = opts;
  const allowed =
    opts.messageIds && opts.messageIds.length > 0
      ? new Set(opts.messageIds)
      : null;

  const feedStructure = readFeedStructure(clientId);
  const columns = parseFeedColumns(feedStructure);
  const feedPatterns = readFeedPatterns(clientId);

  // Per-row text-formatter context. Loaded only if any resolved pattern
  // actually uses the `|formatted` modifier — otherwise we save the SELECT.
  const usesFormatted = columns.some((col) =>
    /\|\s*formatted\b/.test(resolveFeedPattern(col, feedPatterns)),
  );
  const formattingRules: TextFormatting[] = usesFormatted
    ? listTextFormatting(clientId)
    : [];

  // Cache per-template size lookups across messages — buildFeedRowSet may
  // touch hundreds of rows but typically only a handful of templates.
  const sizesByTemplate = new Map<string, string[]>();
  function sizesFor(templateName: string | null | undefined): string[] {
    if (!templateName) return [];
    const cached = sizesByTemplate.get(templateName);
    if (cached) return cached;
    const sizes = readTemplate(templateName)?.sizes ?? [];
    sizesByTemplate.set(templateName, sizes);
    return sizes;
  }

  function buildFormattingCtx(
    m: DbMessage,
  ): Record<string, unknown> | null {
    if (!usesFormatted) return null;
    return {
      [FORMATTING_CTX_KEYS.rules]: formattingRules,
      [FORMATTING_CTX_KEYS.sizes]: sizesFor(m.template),
      [FORMATTING_CTX_KEYS.mcLabel]: mcLabelFor(
        m as unknown as Record<string, unknown>,
      ),
    };
  }

  const audiences = db
    .select()
    .from(audiencesTable)
    .where(eq(audiencesTable.clientId, clientId))
    .all();
  const topics = db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.clientId, clientId))
    .all();
  const audIndex = new Map(audiences.map((a) => [a.key, a]));
  const topIndex = new Map(topics.map((t) => [t.key, t]));

  // Sticky-superset rule: union of (current ACTIVE+matching-product+!archived)
  // and (every message id from the latest uploaded export). The carry-forwards
  // get re-evaluated through the current patterns; archived messages keep
  // their content but get IsActive forced FALSE downstream.
  const liveExport = findLiveExport(clientId, product);
  const liveIds = readLiveMessageIds(liveExport);

  const allMessages = db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.clientId, clientId))
    .all();

  // Match the v6 matrix view's product-filter semantics exactly: a message is
  // in the product when BOTH its audience and its topic carry that product.
  // Earlier versions OR'd audience/topic, which let in messages whose audience
  // had a different product but happened to share a topic with the requested
  // product (e.g. an adform-product topic dragging in dv360-audience rows).
  // Topics with NULL product are excluded — same as the matrix UI behaviour.
  const productAudKeys = new Set(
    audiences.filter((a) => a.product === product).map((a) => a.key),
  );
  const productTopicKeys = new Set(
    topics.filter((t) => t.product === product).map((t) => t.key),
  );

  const liveIdSet = new Set(liveIds);

  const inSet: DbMessage[] = [];
  for (const m of allMessages) {
    if (allowed && !allowed.has(m.id)) continue;
    const matchesProduct =
      productAudKeys.has(m.audience) && productTopicKeys.has(m.topic);
    const isActive =
      m.status === "ACTIVE" && m.archivedAt === null && matchesProduct;
    if (isActive) {
      inSet.push(m);
      continue;
    }
    if (liveIdSet.has(m.id)) inSet.push(m);
  }

  // Stable sort: by number, then variant, so feeds are reproducible.
  inSet.sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    return (a.variant ?? "").localeCompare(b.variant ?? "");
  });

  const rows: FeedRow[] = [];
  const messageIds: number[] = [];

  const isActiveCol = findColumnByCleanName(columns, "isactive");

  for (const m of inSet) {
    const aud = audIndex.get(m.audience) ?? null;
    const top = topIndex.get(m.topic) ?? null;
    const ctx = buildContext(m, aud, top, audiences, topics);
    const fmt = buildFormattingCtx(m);
    if (fmt) Object.assign(ctx, fmt);
    const row = evaluateRow(m, columns, feedPatterns, ctx);
    if (isActiveCol && m.archivedAt !== null) {
      // Archive trumps status — message has been retired in the system.
      row[isActiveCol] = "FALSE";
    }
    rows.push(row);
    messageIds.push(m.id);
  }

  // DEFAULT row — append last so its index is always rows.length - 1 once
  // pushed.
  let defaultRowIndex = -1;
  let defaultMessage: DbMessage | null = null;
  if (defaultMessageId != null) {
    const defaultMsg = allMessages.find((m) => m.id === defaultMessageId);
    if (defaultMsg) {
      defaultMessage = defaultMsg;
      const aud = audIndex.get(defaultMsg.audience) ?? null;
      const top = topIndex.get(defaultMsg.topic) ?? null;
      const baseCtx = buildContext(defaultMsg, aud, top, audiences, topics);
      const fmt = buildFormattingCtx(defaultMsg);
      if (fmt) Object.assign(baseCtx, fmt);
      const baseRow = evaluateRow(defaultMsg, columns, feedPatterns, baseCtx);
      const defaultRow = buildDefaultRow(
        baseRow,
        defaultMsg,
        aud,
        top,
        audiences,
        topics,
        columns,
        feedPatterns,
        fmt,
      );
      // DEFAULT row is always Active=TRUE regardless of message archive state —
      // it's a serving fallback, not a real message.
      if (isActiveCol) defaultRow[isActiveCol] = "TRUE";
      rows.unshift(defaultRow);
      messageIds.unshift(-1);
      defaultRowIndex = 0;
    }
  }

  return {
    rowSet: { columns, rows, messageIds, defaultRowIndex },
    defaultMessage,
    liveExport,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff

export type RowKeyFn = (row: FeedRow, columns: string[]) => string;

// PMMID-only key. Used for diffing an AdForm snapshot against a freshly built
// MM6 export — MM6 has no advert_id (AdForm allocates it on first upload),
// so the default rowKey would mismatch every row. PMMID is deterministic in
// both systems so it's the only honest cross-system identifier.
export function pmmidRowKey(row: FeedRow, columns: string[]): string {
  const pmmidCol = findColumnByCleanName(columns, "pmmid");
  if (pmmidCol) return row[pmmidCol] ?? "";
  return columns.length > 0 ? row[columns[0]] ?? "" : "";
}

function rowKey(row: FeedRow, columns: string[]): string {
  // Prefer (advert_id, reporting_label) — the AdForm-stable identity. Fall
  // back to the column 0 value if those aren't in the feed.
  const advertIdCol = findColumnByCleanName(columns, "advert_id");
  const reportingCol = findColumnByCleanName(columns, "reportinglabel");
  if (advertIdCol && reportingCol) {
    return `${row[advertIdCol] ?? ""} ${row[reportingCol] ?? ""}`;
  }
  return columns.length > 0 ? row[columns[0]] ?? "" : "";
}

export function diffRowSets(
  prev: FeedRowSet | null,
  next: FeedRowSet,
  keyOf: RowKeyFn = rowKey,
): FeedDiff {
  if (!prev) {
    return {
      added: next.rows.map((_, i) => i),
      removed: [],
      changed: [],
      unchangedCount: 0,
    };
  }

  const prevByKey = new Map<string, number>();
  prev.rows.forEach((r, i) => prevByKey.set(keyOf(r, prev.columns), i));

  const nextByKey = new Map<string, number>();
  next.rows.forEach((r, i) => nextByKey.set(keyOf(r, next.columns), i));

  const added: number[] = [];
  const removed: number[] = [];
  const changed: FeedDiff["changed"] = [];
  let unchangedCount = 0;

  for (const [k, nextIdx] of nextByKey) {
    const prevIdx = prevByKey.get(k);
    if (prevIdx === undefined) {
      added.push(nextIdx);
      continue;
    }
    const fields: string[] = [];
    for (const col of next.columns) {
      const a = prev.rows[prevIdx]?.[col] ?? "";
      const b = next.rows[nextIdx]?.[col] ?? "";
      if (a !== b) fields.push(col);
    }
    if (fields.length === 0) {
      unchangedCount += 1;
    } else {
      changed.push({ prevIndex: prevIdx, nextIndex: nextIdx, fields });
    }
  }
  for (const [k, prevIdx] of prevByKey) {
    if (!nextByKey.has(k)) removed.push(prevIdx);
  }

  return { added, removed, changed, unchangedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Version decision

export function decideVersion(
  liveExport: FeedExport | null,
  next: FeedRowSet,
  diff: FeedDiff,
  forceNewVersion: boolean,
): VersionDecision {
  if (!liveExport) {
    return { feedVersion: 1, action: "first", reasons: [] };
  }

  const reasons: string[] = [];
  if (forceNewVersion) reasons.push("user requested new version");
  if (next.rows.length > MAX_ROWS_PER_FEED) {
    reasons.push(
      `row count ${next.rows.length} exceeds ${MAX_ROWS_PER_FEED}-row limit`,
    );
  }
  if (diff.removed.length > 0) {
    reasons.push(
      `${diff.removed.length} live row${diff.removed.length === 1 ? "" : "s"} would be removed (sticky-superset rule)`,
    );
  }

  if (reasons.length > 0) {
    return {
      feedVersion: liveExport.feedVersion + 1,
      action: "new_version",
      reasons,
    };
  }
  return {
    feedVersion: liveExport.feedVersion,
    action: "append",
    reasons: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX rendering

export function buildXlsxBuffer(rowSet: FeedRowSet): Buffer {
  const { columns, rows } = rowSet;
  const data = [columns, ...rows.map((r) => columns.map((c) => r[c] ?? ""))];
  const buffer = xlsx.build([
    { name: "Feed", data, options: {} },
  ]);
  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers used by routes

export function defaultLabelFor(message: DbMessage): string {
  return message.name
    ? `MC${message.number}${message.variant} — ${message.name}`
    : `MC${message.number}${message.variant}`;
}

export function deserializePayload(json: string): FeedRowSet | null {
  try {
    const obj = JSON.parse(json);
    if (
      obj &&
      Array.isArray(obj.columns) &&
      Array.isArray(obj.rows) &&
      Array.isArray(obj.messageIds) &&
      typeof obj.defaultRowIndex === "number"
    ) {
      return obj as FeedRowSet;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializePayload(rowSet: FeedRowSet): string {
  return JSON.stringify(rowSet);
}

export { MAX_ROWS_PER_FEED };
