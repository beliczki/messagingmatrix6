import { and, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/db";
import {
  audiences,
  clients,
  config as configTable,
  messages,
  reporting,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import {
  BadRequest as AudienceBadRequest,
  archiveAudience,
  createAudience,
  listAudiences,
  pickWritable as pickAudienceWritable,
  restoreAudience,
  updateAudience,
} from "@/lib/entities/audiences";
import {
  TopicError,
  archiveTopic,
  createTopic,
  listTopics,
  pickWritable as pickTopicWritable,
  restoreTopic,
  updateTopic,
} from "@/lib/entities/topics";
import {
  MessageError,
  archiveMessage,
  copyMessages,
  createMessage,
  getMessageByPmmid,
  moveMessages,
  pickWritable as pickMessageWritable,
  restoreMessage,
  updateMessage,
} from "@/lib/entities/messages";
import { isNull } from "drizzle-orm";
import { listVisibleTemplates } from "@/lib/templates";
import { writeAudit } from "@/lib/audit";

export type McpContext = {
  clientId: number;
};

// ── Rate limit ──
// Spec §5.3 — per-client write rate limit, configurable in
// config(client_id, key='mcp.rateLimit'), default 60 calls/min. Fixed 60-second
// window keyed by clientId. One write tool call = one unit (batch counts as 1).
// Single-node in-memory state — v6 doesn't cluster.

type RateState = { count: number; windowStart: number };
const rateState = new Map<number, RateState>();
const RATE_WINDOW_MS = 60_000;

function readRateLimit(clientId: number): number {
  const row = db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .get();
  if (!row) return 60;
  // Read from config(client_id, key='mcp.rateLimit'). Imported lazily to
  // avoid a circular dep with the schema barrel.
  const cfgRow = db
    .select()
    .from(configTable)
    .where(
      and(eq(configTable.clientId, clientId), eq(configTable.key, "mcp.rateLimit")),
    )
    .get();
  if (!cfgRow) return 60;
  const parsed = Number(cfgRow.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function checkAndConsumeRate(clientId: number): {
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
} {
  const now = Date.now();
  const limit = readRateLimit(clientId);
  let s = rateState.get(clientId);
  if (!s || now - s.windowStart >= RATE_WINDOW_MS) {
    s = { count: 0, windowStart: now };
    rateState.set(clientId, s);
  }
  if (s.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: s.windowStart + RATE_WINDOW_MS,
      limit,
    };
  }
  s.count += 1;
  return {
    ok: true,
    remaining: limit - s.count,
    resetAt: s.windowStart + RATE_WINDOW_MS,
    limit,
  };
}

// Test-only — clear state between integration tests.
export function _resetMcpRateLimitForTests() {
  rateState.clear();
}

// Spec §5 + master plan D8. Per-client bearer:
//   Authorization: Bearer <token>     (standard)
//   ?secret=<token>                   (claude.ai connector compat)
// Deploy-pinned: bearer's resolved client must match ACTIVE_CLIENT_KEY.
export function resolveBearerClient(req: Request): McpContext | null {
  const auth = req.headers.get("authorization");
  let token: string | null = null;
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    token = auth.slice(7).trim();
  }
  if (!token) {
    const url = new URL(req.url);
    token = url.searchParams.get("secret");
  }
  if (!token) return null;

  const row = db
    .select()
    .from(clients)
    .where(eq(clients.mcpToken, token))
    .get();
  if (!row) return null;

  if (row.id !== activeClientId()) return null;

  return { clientId: row.id };
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function registerReadTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_audiences",
    {
      description:
        "List audiences for the active client. Filters: product. Default excludes soft-archived rows; pass include_archived=true to see them.",
      inputSchema: {
        product: z.string().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ product, include_archived }) => {
      let rows = listAudiences(ctx.clientId, {
        includeArchived: include_archived,
      });
      if (product) rows = rows.filter((r) => r.product === product);
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "list_topics",
    {
      description:
        "List topics for the active client. Filters: product. Default excludes soft-archived rows; pass include_archived=true to see them.",
      inputSchema: {
        product: z.string().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ product, include_archived }) => {
      let rows = listTopics(ctx.clientId, {
        includeArchived: include_archived,
      });
      if (product) rows = rows.filter((r) => r.product === product);
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "list_mc",
    {
      description:
        "List messages (MCs). Filters: topic_key, audience_key, product (matches either audience.product or topic.product), status, monitoring_status (matches reporting.adform_status for the MC), limit (default 100). Default excludes soft-archived rows; pass include_archived=true to see them.",
      inputSchema: {
        topic_key: z.string().optional(),
        audience_key: z.string().optional(),
        product: z.string().optional(),
        status: z.string().optional(),
        monitoring_status: z.string().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async (args) => {
      const conds = [eq(messages.clientId, ctx.clientId)];
      if (!args.include_archived) conds.push(isNull(messages.archivedAt));
      if (args.topic_key) conds.push(eq(messages.topic, args.topic_key));
      if (args.audience_key) conds.push(eq(messages.audience, args.audience_key));
      if (args.status) conds.push(eq(messages.status, args.status));
      if (args.product) {
        const audKeys = db
          .select({ key: audiences.key })
          .from(audiences)
          .where(
            and(
              eq(audiences.clientId, ctx.clientId),
              eq(audiences.product, args.product),
            ),
          )
          .all()
          .map((r) => r.key);
        const topKeys = db
          .select({ key: topics.key })
          .from(topics)
          .where(
            and(
              eq(topics.clientId, ctx.clientId),
              eq(topics.product, args.product),
            ),
          )
          .all()
          .map((r) => r.key);
        if (audKeys.length === 0 && topKeys.length === 0) return jsonResult([]);
        conds.push(
          sql`(${messages.audience} IN ${audKeys.length ? audKeys : [""]} OR ${messages.topic} IN ${topKeys.length ? topKeys : [""]})`,
        );
      }
      if (args.monitoring_status) {
        const labels = db
          .select({ label: reporting.mcLabel })
          .from(reporting)
          .where(
            and(
              eq(reporting.clientId, ctx.clientId),
              eq(reporting.adformStatus, args.monitoring_status),
            ),
          )
          .all()
          .map((r) => r.label)
          .filter((l): l is string => !!l);
        if (labels.length === 0) return jsonResult([]);
        conds.push(inArray(messages.pmmid, labels));
      }
      const limit = args.limit ?? 100;
      const rows = db
        .select()
        .from(messages)
        .where(and(...conds))
        .orderBy(messages.number, messages.variant)
        .limit(limit)
        .all();
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "mc_get",
    {
      description:
        "Get a single message by its MC label (PMMID). Returns null if not found.",
      inputSchema: { mc_label: z.string() },
    },
    async ({ mc_label }) => {
      const row =
        db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.clientId, ctx.clientId),
              eq(messages.pmmid, mc_label),
            ),
          )
          .get() ?? null;
      return jsonResult(row);
    },
  );
}

function registerMetaTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "list_templates",
    {
      description:
        "List templates visible to the active client, with sizes and placeholder bindings.",
      inputSchema: {},
    },
    async () => jsonResult(listVisibleTemplates(ctx.clientId)),
  );

  server.registerTool(
    "list_products",
    {
      description:
        "List distinct product values used across audiences and topics.",
      inputSchema: {},
    },
    async () => {
      const audProducts = db
        .select({ product: audiences.product })
        .from(audiences)
        .where(eq(audiences.clientId, ctx.clientId))
        .all()
        .map((r) => r.product);
      const topProducts = db
        .select({ product: topics.product })
        .from(topics)
        .where(eq(topics.clientId, ctx.clientId))
        .all()
        .map((r) => r.product);
      const set = new Set<string>();
      for (const p of [...audProducts, ...topProducts]) {
        if (p && p.trim()) set.add(p.trim());
      }
      return jsonResult([...set].sort());
    },
  );

  server.registerTool(
    "matrix_status",
    {
      description:
        "Quick health/state snapshot for the active client: row counts and last reporting sync timestamp.",
      inputSchema: {},
    },
    async () => {
      const audCount = db
        .select({ c: sql<number>`count(*)` })
        .from(audiences)
        .where(eq(audiences.clientId, ctx.clientId))
        .get()?.c ?? 0;
      const topCount = db
        .select({ c: sql<number>`count(*)` })
        .from(topics)
        .where(eq(topics.clientId, ctx.clientId))
        .get()?.c ?? 0;
      const msgRows = db
        .select({ status: messages.status })
        .from(messages)
        .where(eq(messages.clientId, ctx.clientId))
        .all();
      const byStatus: Record<string, number> = {};
      for (const r of msgRows) {
        const k = r.status ?? "(null)";
        byStatus[k] = (byStatus[k] ?? 0) + 1;
      }
      const lastSync =
        db
          .select({ ts: max(reporting.syncedAt) })
          .from(reporting)
          .where(eq(reporting.clientId, ctx.clientId))
          .get()?.ts ?? null;
      return jsonResult({
        audiences: audCount,
        topics: topCount,
        messages: { total: msgRows.length, by_status: byStatus },
        last_reporting_sync: lastSync,
        last_export: null, // No export-history tracking yet — Phase 8d/9c TBD.
      });
    },
  );

  server.registerTool(
    "get_mc_reporting",
    {
      description:
        "Reporting data for an MC label: rolled-up MC-level row + per-banner rows.",
      inputSchema: { mc_label: z.string() },
    },
    async ({ mc_label }) => {
      const rows = db
        .select()
        .from(reporting)
        .where(
          and(
            eq(reporting.clientId, ctx.clientId),
            eq(reporting.mcLabel, mc_label),
          ),
        )
        .all();
      const label = rows.find((r) => r.level === "MC") ?? null;
      const banners = rows.filter((r) => r.level !== "MC");
      return jsonResult({ label, banners });
    },
  );
}

// ── Write tools ──
// Audit byUser is "mcp:<cid>" (Spec §5.3 + master plan D8). Optimistic-lock
// failures bubble up as `isError: true` results carrying the current row so
// the agent can refetch + retry. The lib functions already do all schema
// validation and slot allocation; we just thread inputs through.

function mcpUserId(ctx: McpContext): string {
  return `mcp:${ctx.clientId}`;
}

function errorResult(message: string, extra?: unknown) {
  const text =
    extra === undefined
      ? message
      : `${message}\n${JSON.stringify(extra, null, 2)}`;
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

function requireRate(ctx: McpContext) {
  const r = checkAndConsumeRate(ctx.clientId);
  if (r.ok) return null;
  return errorResult("rate_limited", {
    limit: r.limit,
    resetAt: new Date(r.resetAt).toISOString(),
  });
}

function findAudienceByKey(
  clientId: number,
  key: string,
): Audience | null {
  return (
    db
      .select()
      .from(audiences)
      .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
      .get() ?? null
  );
}

function findTopicByKey(clientId: number, key: string): Topic | null {
  return (
    db
      .select()
      .from(topics)
      .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
      .get() ?? null
  );
}

// Thin alias kept so existing call-sites in this file don't churn.
function findMessageByPmmid(
  clientId: number,
  pmmid: string,
): Message | null {
  return getMessageByPmmid(clientId, pmmid);
}

const fieldsArg = z.record(z.string(), z.unknown()).optional();

function registerAudienceWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "audience_create",
    {
      description:
        "Create an audience. Required: name. Optional fields object: key, orderIndex, status, product, strategy, buyingPlatform, dataSource, targetingType, device, tag, comment, campaignName, campaignId, lineitemName, lineitemId. Returns the new row.",
      inputSchema: { name: z.string(), fields: fieldsArg },
    },
    async ({ name, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const row = createAudience(ctx.clientId, {
          name,
          ...pickAudienceWritable(fields ?? {}),
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "audiences",
          entityId: row.id,
          action: "create",
          after: row,
        });
        return jsonResult(row);
      } catch (e) {
        if (e instanceof AudienceBadRequest) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "audience_update",
    {
      description:
        "Update an audience by key. Required: key, version (current optimistic-lock version). Optional fields object with any writable column.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
        fields: fieldsArg,
      },
    },
    async ({ key, version, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = updateAudience(
        ctx.clientId,
        existing.id,
        version,
        pickAudienceWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "audiences",
        entityId: result.row.id,
        action: "update",
        before: existing,
        after: result.row,
      });
      return jsonResult(result.row);
    },
  );

  server.registerTool(
    "audience_remove",
    {
      description:
        "Archive an audience by key (soft-delete via archived_at). Cascades to all messages attached to this audience by key. Required: key, version. Restore via audience_restore.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
      },
    },
    async ({ key, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = archiveAudience(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "audiences",
        entityId: result.row.id,
        action: "archive",
        before: existing,
        after: result.row,
      });
      return jsonResult({
        ok: true,
        archived: result.row,
        cascadedMessageIds: result.cascadedMessageIds,
      });
    },
  );

  server.registerTool(
    "audience_restore",
    {
      description:
        "Restore an archived audience by key. Required: key, version (the current archived row's version). Does NOT cascade-restore messages — call mc_restore on each one explicitly once the parent is back.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
      },
    },
    async ({ key, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = restoreAudience(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "audiences",
        entityId: result.row.id,
        action: "restore",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, restored: result.row });
    },
  );
}

function registerTopicWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "topic_create",
    {
      description:
        "Create a topic. Required: name. Optional fields object: key, orderIndex, status, product, tag, tag1..4, comment, created. Returns the new row.",
      inputSchema: { name: z.string(), fields: fieldsArg },
    },
    async ({ name, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const row = createTopic(ctx.clientId, {
          name,
          ...pickTopicWritable(fields ?? {}),
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "topics",
          entityId: row.id,
          action: "create",
          after: row,
        });
        return jsonResult(row);
      } catch (e) {
        if (e instanceof TopicError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "topic_update",
    {
      description:
        "Update a topic by key. Required: key, version. Optional fields object with any writable column.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
        fields: fieldsArg,
      },
    },
    async ({ key, version, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = updateTopic(
        ctx.clientId,
        existing.id,
        version,
        pickTopicWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "topics",
        entityId: result.row.id,
        action: "update",
        before: existing,
        after: result.row,
      });
      return jsonResult(result.row);
    },
  );

  server.registerTool(
    "topic_remove",
    {
      description:
        "Archive a topic by key (soft-delete via archived_at). Cascades to all messages attached to this topic by key. Required: key, version. Restore via topic_restore.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
      },
    },
    async ({ key, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = archiveTopic(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "topics",
        entityId: result.row.id,
        action: "archive",
        before: existing,
        after: result.row,
      });
      return jsonResult({
        ok: true,
        archived: result.row,
        cascadedMessageIds: result.cascadedMessageIds,
      });
    },
  );

  server.registerTool(
    "topic_restore",
    {
      description:
        "Restore an archived topic by key. Required: key, version. Does NOT cascade-restore messages.",
      inputSchema: {
        key: z.string(),
        version: z.number().int(),
      },
    },
    async ({ key, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = restoreTopic(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "topics",
        entityId: result.row.id,
        action: "restore",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, restored: result.row });
    },
  );
}

function registerMessageWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "mc_create",
    {
      description:
        "Create a message (MC). Required: audience_key, topic_key. Optional fields object: status, startDate, endDate, template, templateVariantClasses, name, headline, copy1, copy2, disclaimer, *Style fields, customCss, image1..6, video1, flash, flashStyle, cta, ctaStyle, landingUrl, comment, brief. Number/variant/version/PMMID auto-assigned. Returns the new row including pmmid (a.k.a. mc_label).",
      inputSchema: {
        audience_key: z.string(),
        topic_key: z.string(),
        fields: fieldsArg,
      },
    },
    async ({ audience_key, topic_key, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const row = createMessage(ctx.clientId, {
          audience: audience_key,
          topic: topic_key,
          ...pickMessageWritable(fields ?? {}),
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: row.id,
          action: "create",
          after: row,
        });
        return jsonResult(row);
      } catch (e) {
        if (e instanceof MessageError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "mc_update",
    {
      description:
        "Update a message by mc_label (PMMID). Required: mc_label, version. Optional fields object with any writable column.",
      inputSchema: {
        mc_label: z.string(),
        version: z.number().int(),
        fields: fieldsArg,
      },
    },
    async ({ mc_label, version, fields }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = updateMessage(
        ctx.clientId,
        existing.id,
        version,
        pickMessageWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "messages",
        entityId: result.row.id,
        action: "update",
        before: existing,
        after: result.row,
      });
      return jsonResult(result.row);
    },
  );

  server.registerTool(
    "mc_remove",
    {
      description:
        "Archive a message by mc_label (soft-delete via archived_at, bumps version). Required: mc_label, version. Restore via mc_restore (parent-first guard: parent audience and topic must not be archived).",
      inputSchema: {
        mc_label: z.string(),
        version: z.number().int(),
      },
    },
    async ({ mc_label, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = archiveMessage(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "messages",
        entityId: result.row.id,
        action: "archive",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, archived: result.row });
    },
  );

  server.registerTool(
    "mc_restore",
    {
      description:
        "Restore an archived message (MC) by mc_label. Required: mc_label, version. Parent-first: returns parent_archived if the message's audience or topic is currently archived — restore those first.",
      inputSchema: {
        mc_label: z.string(),
        version: z.number().int(),
      },
    },
    async ({ mc_label, version }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      const existing = findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = restoreMessage(ctx.clientId, existing.id, version);
      if (!result.ok) {
        if (result.reason === "parent_archived") {
          return errorResult("parent_archived", {
            parent: result.parent,
            hint: `restore the ${result.parent?.type} '${result.parent?.key}' first`,
          });
        }
        return errorResult("version_conflict", { current: result.current });
      }
      writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "messages",
        entityId: result.row.id,
        action: "restore",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, restored: result.row });
    },
  );
}

// ── Batch tools ──
// All batch tools wrap their work in `db.transaction((tx) => …)`. Better-sqlite3
// transactions are synchronous and run on the same connection, so the entity
// lib functions (which use the `db` proxy) are part of the transaction. Any
// throw inside the body rolls back. Audit is written ONCE per batch with
// action=bulk_create / bulk_update so SSE doesn't lie about uncommitted work
// (writeAudit broadcasts unconditionally — pulling individual audit calls into
// the txn body would emit rollback-then-broadcast on failure).

function registerBatchTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "audience_create_batch",
    {
      description:
        "Create many audiences atomically. Required: audiences (array of { name, fields? }). All-or-nothing — if any item fails validation, the whole batch rolls back and no row is inserted. Returns the inserted rows.",
      inputSchema: {
        audiences: z.array(
          z.object({ name: z.string(), fields: fieldsArg }),
        ),
      },
    },
    async ({ audiences: items }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = db.transaction(() => {
          const out = [];
          for (const it of items) {
            out.push(
              createAudience(ctx.clientId, {
                name: it.name,
                ...pickAudienceWritable(it.fields ?? {}),
              }),
            );
          }
          return out;
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "audiences",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_create",
          after: { count: inserted.length, ids: inserted.map((r) => r.id) },
        });
        return jsonResult({ inserted });
      } catch (e) {
        if (e instanceof AudienceBadRequest) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "topic_create_batch",
    {
      description:
        "Create many topics atomically. Required: topics (array of { name, fields? }). All-or-nothing — rolls back on any failure.",
      inputSchema: {
        topics: z.array(z.object({ name: z.string(), fields: fieldsArg })),
      },
    },
    async ({ topics: items }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = db.transaction(() => {
          const out = [];
          for (const it of items) {
            out.push(
              createTopic(ctx.clientId, {
                name: it.name,
                ...pickTopicWritable(it.fields ?? {}),
              }),
            );
          }
          return out;
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "topics",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_create",
          after: { count: inserted.length, ids: inserted.map((r) => r.id) },
        });
        return jsonResult({ inserted });
      } catch (e) {
        if (e instanceof TopicError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "mc_create_batch",
    {
      description:
        "Create many messages atomically. Required: messages (array of { audience_key, topic_key, fields? }). All-or-nothing — rolls back on any failure. Number/variant/version/PMMID auto-assigned per row.",
      inputSchema: {
        messages: z.array(
          z.object({
            audience_key: z.string(),
            topic_key: z.string(),
            fields: fieldsArg,
          }),
        ),
      },
    },
    async ({ messages: items }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = db.transaction(() => {
          const out = [];
          for (const it of items) {
            out.push(
              createMessage(ctx.clientId, {
                audience: it.audience_key,
                topic: it.topic_key,
                ...pickMessageWritable(it.fields ?? {}),
              }),
            );
          }
          return out;
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_create",
          after: { count: inserted.length, ids: inserted.map((r) => r.id) },
        });
        return jsonResult({ inserted });
      } catch (e) {
        if (e instanceof MessageError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "mc_update_batch",
    {
      description:
        "Update many messages atomically. Required: updates (array of { mc_label, version, fields? }). All-or-nothing — rolls back if any optimistic-lock check fails or any row is missing. On conflict, returns isError with the failing mc_label.",
      inputSchema: {
        updates: z.array(
          z.object({
            mc_label: z.string(),
            version: z.number().int(),
            fields: fieldsArg,
          }),
        ),
      },
    },
    async ({ updates }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const updated = db.transaction(() => {
          const out = [];
          for (const u of updates) {
            const existing = findMessageByPmmid(ctx.clientId, u.mc_label);
            if (!existing) {
              throw new BatchError(
                `message '${u.mc_label}' not found`,
                u.mc_label,
              );
            }
            const r = updateMessage(
              ctx.clientId,
              existing.id,
              u.version,
              pickMessageWritable(u.fields ?? {}),
            );
            if (!r.ok) {
              throw new BatchError(
                `version_conflict on '${u.mc_label}'`,
                u.mc_label,
                r.current,
              );
            }
            out.push(r.row);
          }
          return out;
        });
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_update",
          after: { count: updated.length, ids: updated.map((r) => r.id) },
        });
        return jsonResult({ updated });
      } catch (e) {
        if (e instanceof BatchError) {
          return errorResult(e.message, {
            mc_label: e.mcLabel,
            current: e.current,
          });
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "mc_copy_batch",
    {
      description:
        "Copy each source message into each target audience (under the source's topic). Required: source_mc_labels (PMMIDs), target_audience_keys. Optional field_overrides merged on top of cloned fields. All-or-nothing — any unknown source rolls back the whole batch. New PMMIDs are generated against the target audience.",
      inputSchema: {
        source_mc_labels: z.array(z.string()),
        target_audience_keys: z.array(z.string()),
        field_overrides: fieldsArg,
      },
    },
    async ({ source_mc_labels, target_audience_keys, field_overrides }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const result = db.transaction(() =>
          copyMessages(ctx.clientId, source_mc_labels, target_audience_keys, {
            fieldOverrides: pickMessageWritable(field_overrides ?? {}),
          }),
        );
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_copy",
          after: {
            count: result.created.length,
            ids: result.created.map((r) => r.id),
          },
        });
        return jsonResult({ created: result.created });
      } catch (e) {
        if (e instanceof MessageError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "mc_move_batch",
    {
      description:
        "Move messages into a single target audience (same topic only). Required: moves (array of { mc_label, version }), target_audience_key. PMMID is preserved; UTM columns are regenerated against the new audience. Variant auto-bumps on collision. All-or-nothing — any version_conflict / not_found / cross_topic / unknown audience rolls the batch back.",
      inputSchema: {
        moves: z.array(
          z.object({ mc_label: z.string(), version: z.number().int() }),
        ),
        target_audience_key: z.string(),
      },
    },
    async ({ moves, target_audience_key }) => {
      const limited = requireRate(ctx);
      if (limited) return limited;
      try {
        const result = db.transaction(() =>
          moveMessages(
            ctx.clientId,
            moves.map((m) => ({
              mcLabel: m.mc_label,
              expectedVersion: m.version,
            })),
            target_audience_key,
          ),
        );
        if (!result.ok) {
          throw new BatchError(result.reason, result.mcLabel, result.current);
        }
        writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: `bulk:${ctx.clientId}`,
          action: "bulk_move",
          after: {
            count: result.updated.length,
            ids: result.updated.map((r) => r.id),
          },
        });
        return jsonResult({ updated: result.updated });
      } catch (e) {
        if (e instanceof BatchError) {
          return errorResult(e.message, {
            mc_label: e.mcLabel,
            current: e.current,
          });
        }
        throw e;
      }
    },
  );
}

class BatchError extends Error {
  constructor(
    message: string,
    public mcLabel: string,
    public current: unknown = null,
  ) {
    super(message);
    this.name = "BatchError";
  }
}

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "messagingmatrix", version: "6.0.0-pre" },
    { capabilities: { tools: {} } },
  );
  registerReadTools(server, ctx);
  registerMetaTools(server, ctx);
  registerAudienceWriteTools(server, ctx);
  registerTopicWriteTools(server, ctx);
  registerMessageWriteTools(server, ctx);
  registerBatchTools(server, ctx);
  return server;
}
