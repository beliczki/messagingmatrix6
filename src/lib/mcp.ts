import { and, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db } from "@/db";
import {
  assets,
  audiences,
  clients,
  creatives,
  config as configTable,
  mcpTokens,
  messagePreviews,
  messages,
  monitoring,
  nowUtc,
  reporting,
  uploadedFiles,
  topics,
  users,
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
  getMessage,
  getMessageByPmmid,
  listDrafts,
  moveMessages,
  pickWritable as pickMessageWritable,
  promoteDraft,
  restoreMessage,
  updateMessage,
} from "@/lib/entities/messages";
import { isNotNull, isNull } from "drizzle-orm";
import { periodDateKey } from "@/lib/period";
import { driveFileUrl, driveFolderUrl } from "@/lib/drive-link";
import { listVisibleTemplates, readTemplate } from "@/lib/templates";
import { collectStalePreviews } from "@/lib/previews";
import { shootPreviews } from "@/lib/preview-shooter";
import { createAsset } from "@/lib/entities/assets";
import {
  archiveCreative,
  getCreative,
  pickWritable as pickCreativeWritable,
  restoreCreative,
  updateCreative,
  listCreatives,
} from "@/lib/entities/creatives";
import {
  createCreativeWithMirror,
  promoteCreative,
  PromoteError,
} from "@/lib/entities/promote";
import {
  DraftError,
  createTestCreative,
  draftSizes,
  getDraftStatus,
  listDraftPreviews,
  startDraftRender,
  type DraftPreviewRow,
  type TestCreativeInput,
} from "@/lib/entities/drafts";
import {
  briefFileIdFromLink,
  BriefError,
  listBriefDecks,
} from "@/lib/entities/briefs";
import { parseSlideAnchor } from "@/lib/slides-link";
import {
  listProdlistRows,
  upsertProdlistRows,
  type ProdlistUpsertRow,
} from "@/lib/entities/prodlist";
import {
  getFileByFilename,
  sanitizeFilename,
  uploadFile,
} from "@/lib/entities/files";
import { fetchRemoteFile } from "@/lib/fetch-remote-file";
import {
  DEFAULT_CREATIVE_PARSING_RULES,
} from "@/db/defaults";
import { parseFilename, type ParseRules } from "@/lib/parse-filename";
import { extFromFilename, readFileBytes } from "@/lib/storage";
import {
  MC_PREVIEWS_TEMPLATE_URI,
  MC_PREVIEWS_WIDGET_HTML,
} from "@/lib/mcp-widget";
import { writeAudit } from "@/lib/audit";

export type McpContext = {
  clientId: number;
  /** Token owner (users.id) — audit rows are attributed to this user,
   *  identical to writes made in the UI by the same person. */
  userId: string;
  /** 'read' registers only the read/meta tools; 'full' registers everything. */
  scope: "full" | "read";
  /** mcp_tokens.id — absent in the tools-inventory route, which only
   *  introspects schemas and never runs handlers. */
  tokenId?: number;
  /** Origin the MCP client dialed (e.g. https://erste.messagingmatrix.ai),
   *  used to build absolute preview URLs. Absent in the tools-inventory
   *  route, which only introspects schemas and never runs handlers. */
  origin?: string;
};

// ── Rate limit ──
// Spec §5.3 — per-client write rate limit, configurable in
// config(client_id, key='mcp.rateLimit'), default 60 calls/min. Fixed 60-second
// window keyed by clientId. One write tool call = one unit (batch counts as 1).
// Single-node in-memory state — v6 doesn't cluster.

type RateState = { count: number; windowStart: number };
const rateState = new Map<number, RateState>();
const RATE_WINDOW_MS = 60_000;

async function readRateLimit(clientId: number): Promise<number> {
  const [row] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!row) return 60;
  // Read from config(client_id, key='mcp.rateLimit').
  const [cfgRow] = await db
    .select()
    .from(configTable)
    .where(
      and(eq(configTable.clientId, clientId), eq(configTable.key, "mcp.rateLimit")),
    )
    .limit(1);
  if (!cfgRow) return 60;
  const parsed = Number(cfgRow.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

async function checkAndConsumeRate(clientId: number): Promise<{
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}> {
  const now = Date.now();
  const limit = await readRateLimit(clientId);
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

// Spec §5 + master plan D8. Per-user bearer tokens (mcp_tokens):
//   Authorization: Bearer <token>     (standard)
//   ?secret=<token>                   (claude.ai connector compat)
// Deploy-pinned: bearer's resolved client must match ACTIVE_CLIENT_KEY.
// Revoked tokens (archived_at) and archived owners 401 on the next request —
// same live re-check the web session does in session.ts.
export async function resolveBearerClient(
  req: Request,
): Promise<McpContext | null> {
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

  const [row] = await db
    .select({ tok: mcpTokens })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(
      and(
        eq(mcpTokens.token, token),
        isNull(mcpTokens.archivedAt),
        isNull(users.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (row.tok.clientId !== (await activeClientId())) return null;

  await db
    .update(mcpTokens)
    .set({ lastUsedAt: nowUtc })
    .where(eq(mcpTokens.id, row.tok.id));

  return {
    clientId: row.tok.clientId,
    userId: row.tok.userId,
    scope: row.tok.scope === "read" ? "read" : "full",
    tokenId: row.tok.id,
    origin: requestOrigin(req),
  };
}

// The origin the client actually dialed. `req.url` is unreliable behind the
// nginx proxy — `next start` rebuilds it from its bind address (localhost:6001)
// — so prefer the standard forwarded headers, then Host, then req.url.
function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto =
    req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

// Resolve an agent-supplied `from` (ISO or native) to the exact stored
// period_from string among `available`. Exact match wins; otherwise compare by
// date key. Returns null when nothing matches (caller surfaces the choices).
function resolvePeriodFrom(fromArg: string, available: string[]): string | null {
  if (available.includes(fromArg)) return fromArg;
  const target = periodDateKey(fromArg);
  if (!target) return null;
  return available.find((p) => periodDateKey(p) === target) ?? null;
}

// Preview URLs use a STABLE row id but the bytes change on every regenerate.
// Without a cache-buster the same URL keeps serving the pre-regen image from the
// browser / CDN / ChatGPT image-proxy cache. We key ?v on the preview row's
// updated_at (set to now() on every (re)shot) — identical to how the matrix
// editor builds these URLs (MessageEditor.tsx), so both share one cache entry.
function previewUrl(
  origin: string,
  id: number,
  updatedAt: string | null,
): string {
  return `${origin}/api/previews/${id}?v=${encodeURIComponent(updatedAt ?? "")}`;
}

// A draft's previews ARE message previews now (a draft is a message row), so
// they serve from the same public, active-client-scoped route — there is no
// separate draft-preview endpoint any more.
const draftPreviewUrl = previewUrl;

// Guards for the image-content tools: keep a single tool result from ballooning
// (base64 inflates ~33%). Individual files over the cap, or more than N previews,
// are skipped with a note rather than returned.
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_IMAGES = 16;

function imageContent(bytes: Buffer, mimeType: string) {
  return { type: "image" as const, data: bytes.toString("base64"), mimeType };
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
      let rows = await listAudiences(ctx.clientId, {
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
      let rows = await listTopics(ctx.clientId, {
        includeArchived: include_archived,
      });
      if (product) rows = rows.filter((r) => r.product === product);
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "list_prodlist",
    {
      description:
        "List prodlist deliverable rows for the active client (one row per production-unit × required asset). Filters: channel (DISP|SOC|PRG|GSN|GNW|YT). Default excludes soft-archived rows; pass include_archived=true to see them. These rows are the source of the Agentic channel-audience set and the creative→channel classification.",
      inputSchema: {
        channel: z.string().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ channel, include_archived }) => {
      const rows = await listProdlistRows(ctx.clientId, {
        includeArchived: include_archived,
        channel,
      });
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "list_mc",
    {
      description:
        "List messages (MCs). Returns a LEAN projection by default (id, number, variant, audience, topic, version_no, pmmid, status, start_date, end_date, template, name, headline) — pass verbose=true for the full row (copy/styles/custom_css/images/video). Each row also carries preview_urls: a {size: url} map of generated PNG screenshots of the rendered HTML creative (e.g. \"300x250\") — fetch with the same Authorization bearer; empty {} when no preview has been generated yet. Paging: limit (default 100, MAX 5000 — set this explicitly to fetch more than 100 in one call) and offset (skip N rows; stable order is number,variant, so offset paging is gap-free for a full export). Filters: topic_key, audience_key, product (matches either audience.product or topic.product), status. Default excludes soft-archived rows; pass include_archived=true to see them. Each row also carries drive_folders: the distinct Google Drive delivery folders of the creatives filed under this MC number+variant ([] when none is recorded).",
      inputSchema: {
        topic_key: z.string().optional(),
        audience_key: z.string().optional(),
        product: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().positive().max(5000).optional(),
        offset: z.number().int().nonnegative().optional(),
        verbose: z.boolean().optional(),
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
        const audKeys = (
          await db
            .select({ key: audiences.key })
            .from(audiences)
            .where(
              and(
                eq(audiences.clientId, ctx.clientId),
                eq(audiences.product, args.product),
              ),
            )
        ).map((r) => r.key);
        const topKeys = (
          await db
            .select({ key: topics.key })
            .from(topics)
            .where(
              and(
                eq(topics.clientId, ctx.clientId),
                eq(topics.product, args.product),
              ),
            )
        ).map((r) => r.key);
        if (audKeys.length === 0 && topKeys.length === 0) return jsonResult([]);
        conds.push(
          sql`(${messages.audience} IN ${audKeys.length ? audKeys : [""]} OR ${messages.topic} IN ${topKeys.length ? topKeys : [""]})`,
        );
      }
      const limit = args.limit ?? 100;
      const offset = args.offset ?? 0;
      // Lean projection: identity, scheduling, naming, and the reporting join
      // key (pmmid) — drops the heavy blobs (copy/styles/custom_css/images).
      // Keeps a full-table fetch cheap enough to page through in context.
      const lean = {
        id: messages.id,
        number: messages.number,
        variant: messages.variant,
        audience: messages.audience,
        topic: messages.topic,
        versionNo: messages.versionNo,
        pmmid: messages.pmmid,
        status: messages.status,
        startDate: messages.startDate,
        endDate: messages.endDate,
        template: messages.template,
        name: messages.name,
        headline: messages.headline,
      };
      const rows = args.verbose
        ? await db
            .select()
            .from(messages)
            .where(and(...conds))
            .orderBy(messages.number, messages.variant)
            .limit(limit)
            .offset(offset)
        : await db
            .select(lean)
            .from(messages)
            .where(and(...conds))
            .orderBy(messages.number, messages.variant)
            .limit(limit)
            .offset(offset);
      // Generated PNG screenshots (scripts/gen-previews.ts) — {size: url} per MC.
      const previewRows = rows.length
        ? await db
            .select({
              id: messagePreviews.id,
              messageId: messagePreviews.messageId,
              size: messagePreviews.size,
              updatedAt: messagePreviews.updatedAt,
            })
            .from(messagePreviews)
            .where(
              and(
                eq(messagePreviews.clientId, ctx.clientId),
                inArray(
                  messagePreviews.messageId,
                  rows.map((r) => r.id),
                ),
              ),
            )
        : [];
      const urlsByMessage = new Map<number, Record<string, string>>();
      for (const p of previewRows) {
        const urls = urlsByMessage.get(p.messageId) ?? {};
        urls[p.size] = previewUrl(ctx.origin ?? "", p.id, p.updatedAt);
        urlsByMessage.set(p.messageId, urls);
      }
      // Where the delivered files of each MC live on Drive — one grouped query
      // for the page, so listing an MC also answers "does this one have a
      // delivery folder at all?".
      const numbers = [...new Set(rows.map((r) => r.number))];
      const driveRows = numbers.length
        ? await db
            .select({
              mcNumber: creatives.mcNumber,
              mcVariant: creatives.mcVariant,
              driveFolderId: creatives.driveFolderId,
              driveFolderName: creatives.driveFolderName,
            })
            .from(creatives)
            .where(
              and(
                eq(creatives.clientId, ctx.clientId),
                isNotNull(creatives.driveFolderId),
                inArray(creatives.mcNumber, numbers),
              ),
            )
        : [];
      const foldersByMc = new Map<string, { url: string; name: string | null }[]>();
      for (const d of driveRows) {
        const key = `${d.mcNumber}|${d.mcVariant ?? ""}`;
        const list = foldersByMc.get(key) ?? [];
        const url = driveFolderUrl(d.driveFolderId)!;
        if (!list.some((f) => f.url === url)) {
          list.push({ url, name: d.driveFolderName });
        }
        foldersByMc.set(key, list);
      }
      return jsonResult(
        rows.map((r) => ({
          ...r,
          preview_urls: urlsByMessage.get(r.id) ?? {},
          drive_folders: foldersByMc.get(`${r.number}|${r.variant ?? ""}`) ?? [],
        })),
      );
    },
  );

  server.registerTool(
    "list_assets",
    {
      description:
        "List media assets (images, videos, logos, etc.) for the active client. Use this to look up the right `file_name` to drop into an MC's `image1..6` / `video1` field. Filters are AND-combined: file_name_contains and visual_keyword_contains are case-insensitive LIKE matches (use them for keyword search, e.g. visual_keyword_contains='fitzone' to find the sport-themed George banner); brand/product/type are exact matches against the indexed columns. Default excludes soft-archived rows; pass include_archived=true to see them. Default limit 100, max 1000. Each row also carries drive_folder_url (the delivery folder on Google Drive — set by whoever uploaded the creative, editable via creative_update) and drive_file_url (the direct link to the file, RESOLVED from that folder by name — read-only). A null drive_folder_url means nobody recorded where this creative was delivered from; a folder without a file url means the resolver has not found it there yet.",
      inputSchema: {
        file_name_contains: z.string().optional(),
        visual_keyword_contains: z.string().optional(),
        brand: z.string().optional(),
        product: z.string().optional(),
        type: z.string().optional(),
        include_archived: z.boolean().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async (args) => {
      const conds = [eq(assets.clientId, ctx.clientId)];
      if (!args.include_archived) conds.push(isNull(assets.archivedAt));
      if (args.file_name_contains) {
        conds.push(
          sql`LOWER(${assets.fileName}) LIKE ${"%" + args.file_name_contains.toLowerCase() + "%"}`,
        );
      }
      if (args.visual_keyword_contains) {
        conds.push(
          sql`LOWER(${assets.visualKeyword}) LIKE ${"%" + args.visual_keyword_contains.toLowerCase() + "%"}`,
        );
      }
      if (args.brand) conds.push(eq(assets.brand, args.brand));
      if (args.product) conds.push(eq(assets.product, args.product));
      if (args.type) conds.push(eq(assets.type, args.type));
      const limit = args.limit ?? 100;
      const rows = await db
        .select()
        .from(assets)
        .where(and(...conds))
        .orderBy(assets.fileName)
        .limit(limit);
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "list_creatives",
    {
      description:
        "List creative-library rows (rendered banner/HTML5 files, keyed to an MC number+variant) for the active client. Distinct from list_assets (raw media the MCs reference) and list_mc (the message rows themselves): a creative is a produced deliverable file with its own brand/product/type/mc_number/mc_variant metadata. Each row carries id and version — pass those to creative_update / creative_remove / creative_restore. Filters are AND-combined: file_name_contains and visual_keyword_contains are case-insensitive LIKE matches; brand/product/type are exact matches; mc_number is an exact integer match. Default excludes soft-archived rows; pass include_archived=true to see them. Default limit 100, max 1000.",
      inputSchema: {
        file_name_contains: z.string().optional(),
        visual_keyword_contains: z.string().optional(),
        brand: z.string().optional(),
        product: z.string().optional(),
        type: z.string().optional(),
        mc_number: z.number().int().optional(),
        include_archived: z.boolean().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      },
    },
    async (args) => {
      const conds = [eq(creatives.clientId, ctx.clientId)];
      if (!args.include_archived) conds.push(isNull(creatives.archivedAt));
      if (args.file_name_contains) {
        conds.push(
          sql`LOWER(${creatives.fileName}) LIKE ${"%" + args.file_name_contains.toLowerCase() + "%"}`,
        );
      }
      if (args.visual_keyword_contains) {
        conds.push(
          sql`LOWER(${creatives.visualKeyword}) LIKE ${"%" + args.visual_keyword_contains.toLowerCase() + "%"}`,
        );
      }
      if (args.brand) conds.push(eq(creatives.brand, args.brand));
      if (args.product) conds.push(eq(creatives.product, args.product));
      if (args.type) conds.push(eq(creatives.type, args.type));
      if (args.mc_number !== undefined)
        conds.push(eq(creatives.mcNumber, args.mc_number));
      const limit = args.limit ?? 100;
      const rows = await db
        .select()
        .from(creatives)
        .where(and(...conds))
        .orderBy(creatives.id)
        .limit(limit);
      // Hand over the finished links, not just the ids — an agent should not
      // have to know how a Drive URL is spelled.
      return jsonResult(
        rows.map((r) => ({
          ...r,
          drive_folder_url: driveFolderUrl(r.driveFolderId),
          drive_file_url: driveFileUrl(r.driveFileId),
        })),
      );
    },
  );

  server.registerTool(
    "list_report_periods",
    {
      description:
        "List the imported monitoring report periods for the active client, newest first. Each entry: from (period_from, the value to pass as `from` to report_performance), to (period_to), rows (row count), impressions/clicks/cost (period totals). Use this to discover which periods exist before calling report_performance for a specific one.",
      inputSchema: {},
    },
    async () => {
      const periods = await db
        .select({
          from: monitoring.periodFrom,
          to: monitoring.periodTo,
          rows: sql<number>`count(*)::int`,
          impressions: sql<number>`coalesce(sum(${monitoring.impressions}), 0)::int`,
          clicks: sql<number>`coalesce(sum(${monitoring.clicks}), 0)::int`,
          cost: sql<number>`coalesce(sum(${monitoring.cost}), 0)::float8`,
        })
        .from(monitoring)
        .where(eq(monitoring.clientId, ctx.clientId))
        .groupBy(monitoring.periodFrom, monitoring.periodTo)
        .orderBy(desc(monitoring.periodFrom));
      return jsonResult(periods);
    },
  );

  server.registerTool(
    "report_performance",
    {
      description:
        "Aggregated creative performance from imported monitoring reports, broken down by product × platform, each split into matched vs unmatched. Matched = the report row resolved to a matrix message (message_id not null); unmatched = it did not. Metrics per bucket: impressions, clicks, cost, ctr (clicks/impressions, null when impressions=0). Defaults to the NEWEST report period; pass from (a period_from value from list_report_periods, or a plain ISO date like 2026-06-01) to pick another. Optional exact filters: product, platform. Returns { period: {from,to}, rows: [{product, platform, matched, unmatched, total}], totals: {matched, unmatched, total} }. Rows sorted by total impressions desc. Empty rows + null period when no reports are imported.",
      inputSchema: {
        from: z.string().optional(),
        product: z.string().optional(),
        platform: z.string().optional(),
      },
    },
    async (args) => {
      const periods = await db
        .selectDistinct({
          from: monitoring.periodFrom,
          to: monitoring.periodTo,
        })
        .from(monitoring)
        .where(eq(monitoring.clientId, ctx.clientId))
        .orderBy(desc(monitoring.periodFrom));
      if (periods.length === 0) {
        const z = { impressions: 0, clicks: 0, cost: 0, ctr: null };
        return jsonResult({
          period: null,
          rows: [],
          totals: { matched: z, unmatched: z, total: z },
        });
      }
      const resolvedFrom = args.from
        ? resolvePeriodFrom(
            args.from,
            periods.map((p) => p.from),
          )
        : periods[0].from;
      const sel = periods.find((p) => p.from === resolvedFrom);
      if (!sel) {
        return errorResult(`no report period matching from='${args.from}'`, {
          available: periods.map((p) => p.from),
        });
      }

      const conds = [
        eq(monitoring.clientId, ctx.clientId),
        eq(monitoring.periodFrom, sel.from),
      ];
      if (args.product) conds.push(eq(monitoring.product, args.product));
      if (args.platform) conds.push(eq(monitoring.platform, args.platform));
      const matchedExpr = sql<boolean>`(${monitoring.messageId} IS NOT NULL)`;
      const agg = await db
        .select({
          product: monitoring.product,
          platform: monitoring.platform,
          matched: matchedExpr,
          impressions: sql<number>`coalesce(sum(${monitoring.impressions}), 0)::int`,
          clicks: sql<number>`coalesce(sum(${monitoring.clicks}), 0)::int`,
          cost: sql<number>`coalesce(sum(${monitoring.cost}), 0)::float8`,
        })
        .from(monitoring)
        .where(and(...conds))
        .groupBy(monitoring.product, monitoring.platform, matchedExpr);

      type Bucket = { impressions: number; clicks: number; cost: number };
      const zero = (): Bucket => ({ impressions: 0, clicks: 0, cost: 0 });
      const add = (b: Bucket, r: (typeof agg)[number]) => {
        b.impressions += r.impressions;
        b.clicks += r.clicks;
        b.cost += r.cost;
      };
      const withCtr = (b: Bucket) => ({
        ...b,
        ctr: b.impressions > 0 ? b.clicks / b.impressions : null,
      });
      const sum = (a: Bucket, b: Bucket): Bucket => ({
        impressions: a.impressions + b.impressions,
        clicks: a.clicks + b.clicks,
        cost: a.cost + b.cost,
      });

      const cells = new Map<
        string,
        { product: string | null; platform: string; matched: Bucket; unmatched: Bucket }
      >();
      const grandMatched = zero();
      const grandUnmatched = zero();
      for (const r of agg) {
        const key = `${r.product ?? ""}|${r.platform}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = { product: r.product, platform: r.platform, matched: zero(), unmatched: zero() };
          cells.set(key, cell);
        }
        add(r.matched ? cell.matched : cell.unmatched, r);
        add(r.matched ? grandMatched : grandUnmatched, r);
      }

      const rows = [...cells.values()]
        .map((c) => ({
          product: c.product,
          platform: c.platform,
          matched: withCtr(c.matched),
          unmatched: withCtr(c.unmatched),
          total: withCtr(sum(c.matched, c.unmatched)),
        }))
        .sort((a, b) => b.total.impressions - a.total.impressions);

      return jsonResult({
        period: { from: sel.from, to: sel.to },
        rows,
        totals: {
          matched: withCtr(grandMatched),
          unmatched: withCtr(grandUnmatched),
          total: withCtr(sum(grandMatched, grandUnmatched)),
        },
      });
    },
  );

  server.registerTool(
    "mc_get",
    {
      description:
        "Get one or more MCs, each with preview_urls — the {size: url} PNG-screenshot map (same shape as list_mc; fetch with the same Authorization bearer, empty {} when no preview generated yet). Look up by EXACTLY ONE of: mc_label (PMMID — yields at most one row) OR mc_number (optionally narrowed by variant). A number can live in several cells / variants (card fan-out is a copy), so a number/variant lookup may match MULTIPLE rows — the result is therefore ALWAYS an ARRAY (empty when nothing matches). Default excludes soft-archived rows; pass include_archived=true to include them. Ordered by number, variant.",
      inputSchema: {
        mc_label: z.string().optional(),
        mc_number: z.number().int().optional(),
        variant: z.string().optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async (args) => {
      const hasLabel = args.mc_label !== undefined;
      const hasNumber = args.mc_number !== undefined;
      if (hasLabel === hasNumber) {
        return errorResult("provide exactly one of mc_label or mc_number");
      }
      if (args.variant !== undefined && !hasNumber) {
        return errorResult("variant can only be used together with mc_number");
      }
      const conds = [eq(messages.clientId, ctx.clientId)];
      if (hasLabel) conds.push(eq(messages.pmmid, args.mc_label!));
      if (hasNumber) conds.push(eq(messages.number, args.mc_number!));
      if (args.variant !== undefined)
        conds.push(eq(messages.variant, args.variant));
      if (!args.include_archived) conds.push(isNull(messages.archivedAt));
      const rows = await db
        .select()
        .from(messages)
        .where(and(...conds))
        .orderBy(messages.number, messages.variant);

      // Generated PNG screenshots — {size: url} per MC (same as list_mc).
      const previewRows = rows.length
        ? await db
            .select({
              id: messagePreviews.id,
              messageId: messagePreviews.messageId,
              size: messagePreviews.size,
              updatedAt: messagePreviews.updatedAt,
            })
            .from(messagePreviews)
            .where(
              and(
                eq(messagePreviews.clientId, ctx.clientId),
                inArray(
                  messagePreviews.messageId,
                  rows.map((r) => r.id),
                ),
              ),
            )
        : [];
      const urlsByMessage = new Map<number, Record<string, string>>();
      for (const p of previewRows) {
        const urls = urlsByMessage.get(p.messageId) ?? {};
        urls[p.size] = previewUrl(ctx.origin ?? "", p.id, p.updatedAt);
        urlsByMessage.set(p.messageId, urls);
      }
      return jsonResult(
        rows.map((r) => ({ ...r, preview_urls: urlsByMessage.get(r.id) ?? {} })),
      );
    },
  );

  server.registerTool(
    "get_mc_preview_files",
    {
      description:
        "Fetch rendered MC preview screenshots as NATIVE MCP image content (image/png bytes inline) — use this, not the preview_urls, when you need to actually LOOK AT the creative (vision analysis). The client receives real image blocks, no auth-token URL to dereference. Identify the MC by EXACTLY ONE of mc_label (PMMID) or mc_number (optionally narrowed by variant and/or audience_key). sizes: optional list (e.g. [\"300x250\",\"970x250\"]) — omit for every generated size of the matched MC(s). Each returned image is preceded by a text line naming it (mc_label + size). Only sizes that already have a generated preview are returned (run preview_generate first if empty). Caps: up to " + MAX_PREVIEW_IMAGES + " images per call; individual files over 8MB skipped with a note.",
      inputSchema: {
        mc_label: z.string().optional(),
        mc_number: z.number().int().optional(),
        variant: z.string().optional(),
        audience_key: z.string().optional(),
        sizes: z.array(z.string()).optional(),
        include_archived: z.boolean().optional(),
      },
    },
    async (args) => {
      const hasLabel = args.mc_label !== undefined;
      const hasNumber = args.mc_number !== undefined;
      if (hasLabel === hasNumber) {
        return errorResult("provide exactly one of mc_label or mc_number");
      }
      if (args.variant !== undefined && !hasNumber) {
        return errorResult("variant can only be used together with mc_number");
      }
      const conds = [eq(messages.clientId, ctx.clientId)];
      if (hasLabel) conds.push(eq(messages.pmmid, args.mc_label!));
      if (hasNumber) conds.push(eq(messages.number, args.mc_number!));
      if (args.variant !== undefined) conds.push(eq(messages.variant, args.variant));
      if (args.audience_key !== undefined)
        conds.push(eq(messages.audience, args.audience_key));
      if (!args.include_archived) conds.push(isNull(messages.archivedAt));
      const mcs = await db
        .select({ id: messages.id, pmmid: messages.pmmid, variant: messages.variant })
        .from(messages)
        .where(and(...conds))
        .orderBy(messages.number, messages.variant);
      if (mcs.length === 0) return errorResult("no MC matched the query");
      const metaById = new Map(mcs.map((m) => [m.id, m]));

      const pconds = [
        eq(messagePreviews.clientId, ctx.clientId),
        inArray(
          messagePreviews.messageId,
          mcs.map((m) => m.id),
        ),
      ];
      if (args.sizes && args.sizes.length > 0) {
        pconds.push(inArray(messagePreviews.size, args.sizes));
      }
      const previews = await db
        .select({
          id: messagePreviews.id,
          messageId: messagePreviews.messageId,
          size: messagePreviews.size,
          storageKey: messagePreviews.storageKey,
        })
        .from(messagePreviews)
        .where(and(...pconds))
        // Newest first, so the (variant,size) dedup keeps the most recently reshot
        // fan-out copy rather than an arbitrary (possibly stale) one.
        .orderBy(desc(messagePreviews.updatedAt), desc(messagePreviews.id));
      if (previews.length === 0) {
        return errorResult(
          "no generated previews for the matched MC" +
            (args.sizes ? " at the requested size(s)" : "") +
            " — run preview_generate first",
        );
      }

      // Dedup by (variant, size): the same variant fanned out across audience
      // cells renders the identical creative (collapse it), but DISTINCT variants
      // (b/c/d) are different creatives and each stays.
      const byVariantSize = new Map<string, (typeof previews)[number]>();
      for (const p of previews) {
        const v = metaById.get(p.messageId)?.variant ?? "";
        const key = `${v}|${p.size}`;
        if (!byVariantSize.has(key)) byVariantSize.set(key, p);
      }
      const uniquePreviews = [...byVariantSize.values()].sort((a, b) => {
        const va = metaById.get(a.messageId)?.variant ?? "";
        const vb = metaById.get(b.messageId)?.variant ?? "";
        return va.localeCompare(vb) || a.size.localeCompare(b.size);
      });

      const pmmidById = new Map(mcs.map((m) => [m.id, m.pmmid]));
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [];
      let count = 0;
      for (const p of uniquePreviews) {
        if (count >= MAX_PREVIEW_IMAGES) {
          content.push({
            type: "text",
            text: `… ${uniquePreviews.length - count} more preview(s) omitted (cap ${MAX_PREVIEW_IMAGES}) — narrow with sizes=[...] or a specific variant/audience_key.`,
          });
          break;
        }
        const label = pmmidById.get(p.messageId) ?? `msg${p.messageId}`;
        const fileName = `${label}_${p.size}.png`;
        let bytes: Buffer;
        try {
          bytes = await readFileBytes(p.storageKey);
        } catch {
          content.push({ type: "text", text: `${fileName}: storage missing` });
          continue;
        }
        if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
          content.push({
            type: "text",
            text: `${fileName}: ${bytes.length} bytes — too large to inline, skipped`,
          });
          continue;
        }
        content.push({
          type: "text",
          text: `${fileName} (mc_label=${label}, size=${p.size})`,
        });
        content.push(imageContent(bytes, "image/png"));
        count++;
      }
      return { content };
    },
  );

  server.registerTool(
    "get_media_file",
    {
      description:
        "Fetch an uploaded asset or creative file as NATIVE MCP image content (real image bytes inline for vision analysis, not an auth-token URL). Identify by file_name (the name MCs/creatives reference, e.g. image1..6 / a creative's fileName); pass category ('asset' or 'creative') to disambiguate when the same name exists in both. Newest file wins when a name was replaced. Returns image content only for image/* files; for non-images (video, HTML5 zip, PDF) it returns an error naming the mime type — use get_mc_preview_files for rendered HTML creatives. Files over 8MB are refused (too large to inline). Excludes soft-archived files.",
      inputSchema: {
        file_name: z.string().min(1),
        category: z.enum(["asset", "creative"]).optional(),
      },
    },
    async (args) => {
      const conds = [
        eq(uploadedFiles.clientId, ctx.clientId),
        eq(uploadedFiles.filename, args.file_name),
        isNull(uploadedFiles.archivedAt),
      ];
      if (args.category) conds.push(eq(uploadedFiles.category, args.category));
      const [file] = await db
        .select()
        .from(uploadedFiles)
        .where(and(...conds))
        .orderBy(desc(uploadedFiles.createdAt))
        .limit(1);
      if (!file) {
        return errorResult(
          `no file named '${args.file_name}'` +
            (args.category ? ` in category '${args.category}'` : ""),
        );
      }
      const mime = file.mimeType ?? "application/octet-stream";
      if (!mime.startsWith("image/")) {
        return errorResult(
          `'${file.filename}' is ${mime}, not an image — this tool returns image content for vision analysis. For rendered HTML creatives use get_mc_preview_files.`,
        );
      }
      if ((file.sizeBytes ?? 0) > MAX_INLINE_IMAGE_BYTES) {
        return errorResult(
          `'${file.filename}' is ${file.sizeBytes} bytes — too large to inline (max ${MAX_INLINE_IMAGE_BYTES})`,
        );
      }
      let bytes: Buffer;
      try {
        bytes = await readFileBytes(file.storagePath);
      } catch {
        return errorResult("storage_missing");
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `${file.filename} (${mime}, category=${file.category})`,
          },
          imageContent(bytes, mime),
        ],
      };
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
    async () => jsonResult(await listVisibleTemplates(ctx.clientId)),
  );

  server.registerTool(
    "list_products",
    {
      description:
        "List distinct product values used across audiences and topics.",
      inputSchema: {},
    },
    async () => {
      const audProducts = (
        await db
          .select({ product: audiences.product })
          .from(audiences)
          .where(eq(audiences.clientId, ctx.clientId))
      ).map((r) => r.product);
      const topProducts = (
        await db
          .select({ product: topics.product })
          .from(topics)
          .where(eq(topics.clientId, ctx.clientId))
      ).map((r) => r.product);
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
      const audCount =
        (
          await db
            .select({ c: sql<number>`count(*)::int` })
            .from(audiences)
            .where(eq(audiences.clientId, ctx.clientId))
        )[0]?.c ?? 0;
      const topCount =
        (
          await db
            .select({ c: sql<number>`count(*)::int` })
            .from(topics)
            .where(eq(topics.clientId, ctx.clientId))
        )[0]?.c ?? 0;
      const msgRows = await db
        .select({ status: messages.status })
        .from(messages)
        .where(eq(messages.clientId, ctx.clientId));
      const byStatus: Record<string, number> = {};
      for (const r of msgRows) {
        const k = r.status ?? "(null)";
        byStatus[k] = (byStatus[k] ?? 0) + 1;
      }
      const lastSync =
        (
          await db
            .select({ ts: max(reporting.syncedAt) })
            .from(reporting)
            .where(eq(reporting.clientId, ctx.clientId))
        )[0]?.ts ?? null;
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
        "Aggregated performance for ONE MC from the imported monitoring reports (the monitoring table — same source as report_performance; the older Reporting-sheet `reporting` table is not populated by the current AdForm pipeline). Look up by EXACTLY ONE of: mc_number (optionally narrowed by variant) — the RELIABLE key, matched against monitoring.mc_number/mc_variant — OR mc_label. mc_label may be a message PMMID (resolved to its number+variant, since the monitoring PMMID carries an extra -l_<lineitem> suffix the message PMMID lacks) or a full monitoring PMMID (matched exactly). A number+variant spans several audience cells, summed together across all imported report periods unless `from` (a period_from from list_report_periods, or a plain ISO date like 2026-06-01) is given. Returns { mc, matched_rows, totals, by_variant, by_size, by_audience }, each metric block = { impressions, clicks, cost, conversions, ctr }. Empty when nothing matched.",
      inputSchema: {
        mc_label: z.string().optional(),
        mc_number: z.number().int().optional(),
        variant: z.string().optional(),
        from: z.string().optional(),
      },
    },
    async (args) => {
      const hasLabel = args.mc_label !== undefined;
      const hasNumber = args.mc_number !== undefined;
      if (hasLabel === hasNumber) {
        return errorResult("provide exactly one of mc_label or mc_number");
      }
      if (args.variant !== undefined && !hasNumber) {
        return errorResult("variant can only be used together with mc_number");
      }

      const conds = [eq(monitoring.clientId, ctx.clientId)];
      if (hasNumber) {
        conds.push(eq(monitoring.mcNumber, args.mc_number!));
        if (args.variant !== undefined)
          conds.push(eq(monitoring.mcVariant, args.variant));
      } else {
        // A message PMMID (no -l_ suffix) resolves to its number+variant;
        // anything else is treated as an exact monitoring PMMID.
        const [msg] = await db
          .select({ number: messages.number, variant: messages.variant })
          .from(messages)
          .where(
            and(
              eq(messages.clientId, ctx.clientId),
              eq(messages.pmmid, args.mc_label!),
            ),
          )
          .limit(1);
        if (msg) {
          conds.push(eq(monitoring.mcNumber, msg.number));
          conds.push(eq(monitoring.mcVariant, msg.variant));
        } else {
          conds.push(eq(monitoring.pmmid, args.mc_label!));
        }
      }
      if (args.from !== undefined) {
        const available = (
          await db
            .selectDistinct({ from: monitoring.periodFrom })
            .from(monitoring)
            .where(eq(monitoring.clientId, ctx.clientId))
        ).map((p) => p.from);
        const resolved = resolvePeriodFrom(args.from, available);
        if (!resolved) {
          return errorResult(`no report period matching from='${args.from}'`, {
            available,
          });
        }
        conds.push(eq(monitoring.periodFrom, resolved));
      }

      const rows = await db
        .select({
          pmmid: monitoring.pmmid,
          size: monitoring.size,
          audienceKey: monitoring.audienceKey,
          mcNumber: monitoring.mcNumber,
          mcVariant: monitoring.mcVariant,
          impressions: monitoring.impressions,
          clicks: monitoring.clicks,
          cost: monitoring.cost,
          conversions: monitoring.conversions,
        })
        .from(monitoring)
        .where(and(...conds));

      type Agg = { impressions: number; clicks: number; cost: number; conversions: number };
      const zero = (): Agg => ({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
      const bump = (a: Agg, r: (typeof rows)[number]) => {
        a.impressions += r.impressions;
        a.clicks += r.clicks;
        a.cost += r.cost;
        a.conversions += r.conversions;
      };
      const withCtr = (a: Agg) => ({
        ...a,
        ctr: a.impressions > 0 ? a.clicks / a.impressions : null,
      });
      const bucket = (m: Map<string, Agg>, key: string, r: (typeof rows)[number]) => {
        const a = m.get(key) ?? zero();
        bump(a, r);
        m.set(key, a);
      };

      const totals = zero();
      const byVariant = new Map<string, Agg>();
      const bySize = new Map<string, Agg>();
      const byAud = new Map<string, Agg>();
      const audPmmid = new Map<string, string>();
      for (const r of rows) {
        bump(totals, r);
        bucket(byVariant, r.mcVariant, r);
        bucket(bySize, r.size, r);
        bucket(byAud, r.audienceKey, r);
        if (r.pmmid) audPmmid.set(r.audienceKey, r.pmmid);
      }
      const bySales = (x: { impressions: number }, y: { impressions: number }) =>
        y.impressions - x.impressions;

      return jsonResult({
        mc: rows[0]
          ? { number: rows[0].mcNumber, variant: args.variant ?? (hasNumber ? null : rows[0].mcVariant) }
          : null,
        matched_rows: rows.length,
        totals: withCtr(totals),
        by_variant: [...byVariant.entries()]
          .map(([variant, a]) => ({ variant, ...withCtr(a) }))
          .sort((x, y) => x.variant.localeCompare(y.variant)),
        by_size: [...bySize.entries()]
          .map(([size, a]) => ({ size, ...withCtr(a) }))
          .sort(bySales),
        by_audience: [...byAud.entries()]
          .map(([audience_key, a]) => ({
            audience_key,
            pmmid: audPmmid.get(audience_key) ?? null,
            ...withCtr(a),
          }))
          .sort(bySales),
      });
    },
  );
}

// ── Write tools ──
// Audit byUser is the token owner's user id — identical to writes made in the
// UI by that user (Spec §5.3 + master plan D8). Optimistic-lock failures
// bubble up as `isError: true` results carrying the current row so the agent
// can refetch + retry. The lib functions already do all schema validation and
// slot allocation; we just thread inputs through.

function mcpUserId(ctx: McpContext): string {
  return ctx.userId;
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

async function requireRate(ctx: McpContext) {
  const r = await checkAndConsumeRate(ctx.clientId);
  if (r.ok) return null;
  return errorResult("rate_limited", {
    limit: r.limit,
    resetAt: new Date(r.resetAt).toISOString(),
  });
}

async function findAudienceByKey(
  clientId: number,
  key: string,
): Promise<Audience | null> {
  const [row] = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
    .limit(1);
  return row ?? null;
}

async function findTopicByKey(
  clientId: number,
  key: string,
): Promise<Topic | null> {
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
    .limit(1);
  return row ?? null;
}

// Thin alias kept so existing call-sites in this file don't churn.
function findMessageByPmmid(
  clientId: number,
  pmmid: string,
): Promise<Message | null> {
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const row = await createAudience(ctx.clientId, {
          name,
          ...pickAudienceWritable(fields ?? {}),
        });
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = await updateAudience(
        ctx.clientId,
        existing.id,
        version,
        pickAudienceWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = await archiveAudience(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findAudienceByKey(ctx.clientId, key);
      if (!existing) return errorResult(`audience '${key}' not found`);
      const result = await restoreAudience(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const row = await createTopic(ctx.clientId, {
          name,
          ...pickTopicWritable(fields ?? {}),
        });
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = await updateTopic(
        ctx.clientId,
        existing.id,
        version,
        pickTopicWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = await archiveTopic(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findTopicByKey(ctx.clientId, key);
      if (!existing) return errorResult(`topic '${key}' not found`);
      const result = await restoreTopic(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
        "Create a message (MC). Required: audience_key, topic_key. Optional fields object: status, startDate, endDate, template, templateVariantClasses, name, headline, copy1, copy2, disclaimer, *Style fields, customCss, image1..6, video1, flash, flashStyle, cta, ctaStyle, landingUrl, comment, brief. Number/variant/version/PMMID auto-assigned (occupied cell: next variant of the cell's first MC number). A cell may hold multiple MC numbers (creative generations): pass mc_number to claim a specific number — if that number already lives in the target cell it adds its next variant; if no MC uses it anywhere it's created as variant 'a' even in an occupied cell; errors otherwise. To place an EXISTING card into more audiences do NOT re-create its number — use mc_copy_batch (it clones the fields, keeping audience copies consistent); to relocate a card use mc_move_batch. Pass mc_number: 'new' to force a brand-new number (max + 1 on the target audience's axis — DCO and Agentic are separate number spaces) in the cell. Pass variant (single letter a–z) to pin the exact variant letter instead of the auto-assigned one (e.g. mc_number 317 + variant 'b' → 317b even with no 317a); errors if that (number, variant) already lives in the target cell. Returns the new row including pmmid (a.k.a. mc_label).",
      inputSchema: {
        audience_key: z.string(),
        topic_key: z.string(),
        mc_number: z
          .union([z.number().int().positive(), z.literal("new")])
          .optional(),
        variant: z
          .string()
          .regex(/^[a-z]$/, "single lowercase letter a–z")
          .optional(),
        fields: fieldsArg,
      },
    },
    async ({ audience_key, topic_key, mc_number, variant, fields }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const row = await createMessage(
          ctx.clientId,
          {
            audience: audience_key,
            topic: topic_key,
            ...pickMessageWritable(fields ?? {}),
          },
          { requestedNumber: mc_number, requestedVariant: variant },
        );
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = await updateMessage(
        ctx.clientId,
        existing.id,
        version,
        pickMessageWritable(fields ?? {}),
      );
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = await archiveMessage(ctx.clientId, existing.id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await findMessageByPmmid(ctx.clientId, mc_label);
      if (!existing) return errorResult(`message '${mc_label}' not found`);
      const result = await restoreMessage(ctx.clientId, existing.id, version);
      if (!result.ok) {
        if (result.reason === "parent_archived") {
          return errorResult("parent_archived", {
            parent: result.parent,
            hint: `restore the ${result.parent?.type} '${result.parent?.key}' first`,
          });
        }
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
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

  server.registerTool(
    "preview_generate",
    {
      description:
        "Generate the stored PNG preview screenshots for the given MCs (one per template size — the same pipeline as npm run gen:previews). Default shoots only missing or stale sizes (stale = the MC was edited since the last shot); force=true reshoots every size. Runs synchronously in headless Chromium on the server — expect a few seconds per size, so keep batches small. Returns per-MC results: generated ({size: url}), skipped_fresh (sizes already up to date), and errors ({size: message}). Counts as one write against the rate limit.",
      inputSchema: {
        mc_labels: z.array(z.string()).min(1).max(20),
        force: z.boolean().optional(),
      },
    },
    async ({ mc_labels, force }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;

      const msgByLabel = new Map<string, Message>();
      const notFound: string[] = [];
      for (const label of mc_labels) {
        const row = await findMessageByPmmid(ctx.clientId, label);
        if (row) msgByLabel.set(label, row);
        else notFound.push(label);
      }

      const { stale } = await collectStalePreviews(ctx.clientId, {
        force: force === true,
        messageIds: [...msgByLabel.values()].map((m) => m.id),
      });
      const shots = await shootPreviews(ctx.clientId, stale);
      const shotsByMessage = new Map<number, typeof shots>();
      for (const s of shots) {
        const list = shotsByMessage.get(s.messageId) ?? [];
        list.push(s);
        shotsByMessage.set(s.messageId, list);
      }

      const results = mc_labels.map((label) => {
        if (notFound.includes(label)) {
          return { mc_label: label, error: `message '${label}' not found` };
        }
        const msg = msgByLabel.get(label)!;
        const generated: Record<string, string> = {};
        const errors: Record<string, string> = {};
        const shotSizes = new Set<string>();
        for (const s of shotsByMessage.get(msg.id) ?? []) {
          shotSizes.add(s.size);
          if (s.ok) {
            generated[s.size] = previewUrl(ctx.origin ?? "", s.previewId, s.updatedAt);
          } else {
            errors[s.size] = s.error;
          }
        }
        const template = msg.template ? readTemplate(msg.template) : null;
        const skipped_fresh =
          template && template.kind === "html"
            ? template.sizes.filter((s) => !shotSizes.has(s))
            : [];
        return { mc_label: label, generated, skipped_fresh, errors };
      });
      return jsonResult(results);
    },
  );
}

// ── Asset write tools ──

const ASSET_BASE64_MAX = 10 * 1024 * 1024; // decoded; MCP JSON is fully buffered
const ASSET_URL_MAX = 50 * 1024 * 1024; // parity with /api/files/upload MAX_BYTES

// Extension → MIME for the formats assets actually hold. Preferred over the
// remote server's content-type (which is often octet-stream on file hosts).
const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

async function clientParsingRules(clientId: number): Promise<ParseRules> {
  const [row] = await db
    .select()
    .from(configTable)
    .where(
      and(
        eq(configTable.clientId, clientId),
        eq(configTable.key, "creativeParsingRules"),
      ),
    )
    .limit(1);
  if (row) {
    try {
      return JSON.parse(row.value) as ParseRules;
    } catch {
      // corrupt JSON → defaults, same as /api/config/parsing-rules
    }
  }
  return DEFAULT_CREATIVE_PARSING_RULES as ParseRules;
}

function registerAssetWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "asset_upload",
    {
      description:
        "Upload a media file and create an asset row for it. Provide the file via EXACTLY ONE of: data_base64 (base64-encoded bytes, max 10MB decoded — for small images) or source_url (a public http(s) URL the server downloads, max 50MB — for larger files/videos; private/internal addresses are refused). The filename matters: MCs reference assets by it (image1..6/video1), and template rendering resolves /api/drive/proxy/<filename> newest-first — so a duplicate filename is REJECTED unless replace_existing=true (then the new file wins resolution; the old file stays). brand/product/type/visual_keyword are auto-derived from the filename via the client's parsing rules; explicit values override. Returns { asset, file, parsed_fields, warnings }; file.deduplicated=true means identical bytes already existed (no new object stored). Counts as one write against the rate limit.",
      inputSchema: {
        filename: z.string().min(1),
        data_base64: z.string().optional(),
        source_url: z.string().optional(),
        brand: z.string().optional(),
        product: z.string().optional(),
        type: z.string().optional(),
        visual_keyword: z.string().optional(),
        comment: z.string().optional(),
        replace_existing: z.boolean().optional(),
      },
    },
    async (args) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;

      if (!args.data_base64 === !args.source_url) {
        return errorResult(
          "provide exactly one of data_base64 or source_url",
        );
      }

      let buffer: Buffer;
      let remoteContentType: string | null = null;
      if (args.data_base64) {
        buffer = Buffer.from(args.data_base64, "base64");
        if (buffer.length === 0) {
          return errorResult("data_base64 decoded to zero bytes — not valid base64?");
        }
        if (buffer.length > ASSET_BASE64_MAX) {
          return errorResult(
            `file too large for base64 transport: ${buffer.length} bytes (max ${ASSET_BASE64_MAX}) — use source_url instead`,
          );
        }
      } else {
        try {
          const fetched = await fetchRemoteFile(args.source_url!, {
            maxBytes: ASSET_URL_MAX,
          });
          buffer = fetched.buffer;
          remoteContentType = fetched.contentType;
        } catch (e) {
          return errorResult(`source_url fetch failed: ${(e as Error).message}`);
        }
      }

      const sanitized = sanitizeFilename(args.filename);
      const existing = await getFileByFilename(ctx.clientId, sanitized);
      if (existing && args.replace_existing !== true) {
        return errorResult("filename_exists", {
          existing_file_id: existing.id,
          hint: "a file with this name already exists and template rendering resolves by filename (newest wins) — pass replace_existing=true to intentionally supersede it, or pick another filename",
        });
      }

      const ext = extFromFilename(args.filename).toLowerCase();
      const mimeType =
        EXT_MIME[ext] ?? remoteContentType ?? "application/octet-stream";

      let dimensions: string | undefined;
      if (mimeType.startsWith("image/")) {
        // Full decode, not just metadata(): the header parses fine on a
        // TRUNCATED file (dimensions live in the first KBs), which is exactly
        // how a clipped base64 payload slips through and stores a broken
        // image. stats() decodes every pixel and fails on premature EOF.
        try {
          const img = sharp(buffer);
          const meta = await img.metadata();
          await img.stats();
          if (meta.width && meta.height) {
            dimensions = `${meta.width}x${meta.height}`;
          }
        } catch (e) {
          return errorResult(
            `image data is corrupt or truncated (${(e as Error).message}) — nothing was stored. If you sent data_base64, the payload was likely clipped in transit; re-encode and retry, or use source_url instead`,
          );
        }
      }

      const file = await uploadFile(ctx.clientId, {
        buffer,
        originalFilename: args.filename,
        mimeType,
        category: "asset",
        uploadedBy: mcpUserId(ctx),
        dimensions,
      });
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "uploaded_files",
        entityId: file.id,
        action: "create",
        after: file,
      });

      const rules = await clientParsingRules(ctx.clientId);
      const parsed = parseFilename(args.filename, rules);
      const asset = await createAsset(ctx.clientId, {
        fileId: file.id,
        fileName: file.filename,
        fileFormat: ext.replace(/^\./, "") || null,
        fileSize: String(file.sizeBytes),
        fileDimensions: file.dimensions,
        brand: args.brand ?? parsed.fields.brand ?? null,
        product: args.product ?? parsed.fields.product ?? null,
        type: args.type ?? parsed.fields.type ?? null,
        visualKeyword: args.visual_keyword ?? parsed.fields.visualKeyword ?? null,
        comment: args.comment ?? null,
      });
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "assets",
        entityId: asset.id,
        action: "create",
        after: asset,
      });

      // Identical bytes already existed under another row → uploadFile reused
      // the stored object instead of writing a new one.
      const [dup] = await db
        .select({ id: uploadedFiles.id })
        .from(uploadedFiles)
        .where(
          and(
            eq(uploadedFiles.clientId, ctx.clientId),
            eq(uploadedFiles.sha256, file.sha256!),
            ne(uploadedFiles.id, file.id),
          ),
        )
        .limit(1);

      return jsonResult({
        asset,
        file: {
          id: file.id,
          filename: file.filename,
          size_bytes: file.sizeBytes,
          mime_type: file.mimeType,
          dimensions: file.dimensions,
          deduplicated: dup !== undefined,
        },
        parsed_fields: parsed.fields,
        warnings: parsed.warnings,
      });
    },
  );
}

function registerCreativeWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "creative_upload",
    {
      description:
        "Upload a rendered creative file (banner / HTML5 export / static image) and create a Creative Library row for it — the creatives-table analog of asset_upload (which targets the SEPARATE Assets library, not this one). Provide the file via EXACTLY ONE of: data_base64 (base64 bytes, max 10MB decoded — small images) or source_url (a public http(s) URL the server downloads, max 50MB — larger files/videos; private/internal addresses are refused). The library tile renders from the stored file by fileId, so a row without an uploaded file would be blank — that's why this uploads bytes rather than taking a bare fileId. brand/product/type/visual_keyword are auto-derived from the filename via the client's parsing rules; explicit values override. Link the creative to a matrix cell by passing mc_number + mc_variant. Returns { creative, file, parsed_fields }. Counts as one write against the rate limit. To edit an existing creative's metadata (re-link, tag, comment) use creative_update instead.",
      inputSchema: {
        filename: z.string().min(1),
        data_base64: z.string().optional(),
        source_url: z.string().optional(),
        brand: z.string().optional(),
        product: z.string().optional(),
        type: z.string().optional(),
        visual_keyword: z.string().optional(),
        copy_keyword: z.string().optional(),
        template: z.string().optional(),
        banner_version: z.string().optional(),
        mc_number: z.number().int().optional(),
        mc_variant: z.string().optional(),
        comment: z.string().optional(),
      },
    },
    async (args) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;

      if (!args.data_base64 === !args.source_url) {
        return errorResult("provide exactly one of data_base64 or source_url");
      }

      let buffer: Buffer;
      let remoteContentType: string | null = null;
      if (args.data_base64) {
        buffer = Buffer.from(args.data_base64, "base64");
        if (buffer.length === 0) {
          return errorResult("data_base64 decoded to zero bytes — not valid base64?");
        }
        if (buffer.length > ASSET_BASE64_MAX) {
          return errorResult(
            `file too large for base64 transport: ${buffer.length} bytes (max ${ASSET_BASE64_MAX}) — use source_url instead`,
          );
        }
      } else {
        try {
          const fetched = await fetchRemoteFile(args.source_url!, {
            maxBytes: ASSET_URL_MAX,
          });
          buffer = fetched.buffer;
          remoteContentType = fetched.contentType;
        } catch (e) {
          return errorResult(`source_url fetch failed: ${(e as Error).message}`);
        }
      }

      const ext = extFromFilename(args.filename).toLowerCase();
      const mimeType =
        EXT_MIME[ext] ?? remoteContentType ?? "application/octet-stream";

      let dimensions: string | undefined;
      if (mimeType.startsWith("image/")) {
        // Full decode (stats), not just metadata(): the header parses fine on a
        // TRUNCATED file, which is exactly how a clipped base64 payload stores a
        // broken image.
        try {
          const img = sharp(buffer);
          const meta = await img.metadata();
          await img.stats();
          if (meta.width && meta.height) {
            dimensions = `${meta.width}x${meta.height}`;
          }
        } catch (e) {
          return errorResult(
            `image data is corrupt or truncated (${(e as Error).message}) — nothing was stored. If you sent data_base64, the payload was likely clipped in transit; re-encode and retry, or use source_url instead`,
          );
        }
      }

      const file = await uploadFile(ctx.clientId, {
        buffer,
        originalFilename: args.filename,
        mimeType,
        category: "creative",
        uploadedBy: mcpUserId(ctx),
        dimensions,
      });
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "uploaded_files",
        entityId: file.id,
        action: "create",
        after: file,
      });

      const rules = await clientParsingRules(ctx.clientId);
      const parsed = parseFilename(args.filename, rules);
      // Same write path as the Creative Library upload: a creative that
      // carries an MC number gets its Agentic cell in the same breath.
      const creative = await createCreativeWithMirror(ctx.clientId, {
        fileId: file.id,
        fileName: file.filename,
        fileFormat: ext.replace(/^\./, "") || null,
        fileSize: String(file.sizeBytes),
        fileDimensions: file.dimensions,
        brand: args.brand ?? parsed.fields.brand ?? null,
        product: args.product ?? parsed.fields.product ?? null,
        type: args.type ?? parsed.fields.type ?? null,
        visualKeyword: args.visual_keyword ?? parsed.fields.visualKeyword ?? null,
        copyKeyword: args.copy_keyword ?? null,
        template: args.template ?? null,
        bannerVersion: args.banner_version ?? null,
        mcNumber: args.mc_number ?? null,
        mcVariant: args.mc_variant ?? null,
        comment: args.comment ?? null,
      });
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "creatives",
        entityId: creative.id,
        action: "create",
        after: creative,
      });

      return jsonResult({
        creative,
        file: {
          id: file.id,
          filename: file.filename,
          size_bytes: file.sizeBytes,
          mime_type: file.mimeType,
          dimensions: file.dimensions,
        },
        parsed_fields: parsed.fields,
      });
    },
  );

  server.registerTool(
    "creative_update",
    {
      description:
        "Update a creative-library row by id. Required: id, version (current optimistic-lock version from list_creatives). Optional fields object with any writable column. To record where a creative was delivered from, pass fields.driveFolderUrl with the Google Drive FOLDER link (a file link is rejected; \"\" clears it). Changing the folder drops the resolved drive_file_url — it is re-derived by the Drive link health check, and cannot be written by hand. Returns version_conflict with the current row if version is stale.",
      inputSchema: {
        id: z.number().int(),
        version: z.number().int(),
        fields: fieldsArg,
      },
    },
    async ({ id, version, fields }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await getCreative(ctx.clientId, id);
      if (!existing) return errorResult(`creative ${id} not found`);
      let writable;
      try {
        writable = pickCreativeWritable(fields ?? {});
      } catch (e) {
        return errorResult((e as Error).message);
      }
      const result = await updateCreative(ctx.clientId, id, version, writable);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "creatives",
        entityId: result.row.id,
        action: "update",
        before: existing,
        after: result.row,
      });
      return jsonResult(result.row);
    },
  );

  server.registerTool(
    "creative_remove",
    {
      description:
        "Archive a creative-library row by id (soft-delete via archived_at). Required: id, version. Restore via creative_restore.",
      inputSchema: {
        id: z.number().int(),
        version: z.number().int(),
      },
    },
    async ({ id, version }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await getCreative(ctx.clientId, id);
      if (!existing) return errorResult(`creative ${id} not found`);
      const result = await archiveCreative(ctx.clientId, id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "creatives",
        entityId: result.row.id,
        action: "archive",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, archived: result.row });
    },
  );

  server.registerTool(
    "creative_restore",
    {
      description:
        "Restore an archived creative-library row by id. Required: id, version (the current archived row's version).",
      inputSchema: {
        id: z.number().int(),
        version: z.number().int(),
      },
    },
    async ({ id, version }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await getCreative(ctx.clientId, id);
      if (!existing) return errorResult(`creative ${id} not found`);
      const result = await restoreCreative(ctx.clientId, id, version);
      if (!result.ok) {
        return errorResult("version_conflict", { current: result.current });
      }
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "creatives",
        entityId: result.row.id,
        action: "restore",
        before: existing,
        after: result.row,
      });
      return jsonResult({ ok: true, restored: result.row });
    },
  );

  server.registerTool(
    "creative_promote",
    {
      description:
        "Promote (\"matrixize\") an uploaded creative into an Agentic MC: creates a template-less message row (image1 = the creative file) on the channel-audience, then back-links the creative via mc_number/mc_variant. This gives the static creative a first-class MC identity addressable everywhere (incl. list_mc/mc_get). Identify the creative by EXACTLY ONE of creative_id or file_name. TWO PATHS, decided by whether the creative already carries an mc_number: (a) NUMBERED (the filename named it, e.g. …_MC324_b_…) — the MC is created AT that number and variant, in the topic that number already occupies on the Agentic axis (or `<PRODUCT>_<keywords>` if the matrix has never seen it); the channel comes from the declared size (1080x1080|1200x628 → SOC, else DISP) unless `channel` overrides it, and `topic_override` does not apply. Uploading such a creative already does this, so this path is for rows that predate the mirror. (b) UNNUMBERED — a fresh number is allocated, the channel comes from explicit `channel` (DISP|SOC|PRG|GSN|GNW|YT) or a prodlist deliverable match on the creative's familyKey, and the topic is auto-derived from the filename unless `topic_override` (an existing topic key) is passed. Refuses if the MC already exists in the matrix. One write against the rate limit. Returns { message, topic, audience }.",
      inputSchema: {
        creative_id: z.number().int().optional(),
        file_name: z.string().optional(),
        channel: z.string().optional(),
        topic_override: z.string().optional(),
      },
    },
    async ({ creative_id, file_name, channel, topic_override }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      if (!creative_id === !file_name) {
        return errorResult("provide exactly one of creative_id or file_name");
      }
      let id = creative_id;
      if (id === undefined && file_name) {
        const matches = (await listCreatives(ctx.clientId)).filter(
          (c) => c.fileName === file_name,
        );
        if (matches.length === 0) {
          return errorResult(`no creative with file_name '${file_name}'`);
        }
        if (matches.length > 1) {
          return errorResult(
            `file_name '${file_name}' matches ${matches.length} creatives — pass creative_id instead`,
          );
        }
        id = matches[0].id;
      }
      try {
        const result = await promoteCreative(ctx.clientId, id!, {
          channel,
          topicOverride: topic_override,
        });
        await writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: result.message.id,
          action: "create",
          after: result.message,
        });
        return jsonResult(result);
      } catch (e) {
        if (e instanceof PromoteError) return errorResult(e.message);
        throw e;
      }
    },
  );
}

// ── Batch tools ──
// All batch tools wrap their work in `await db.transaction(async () => …)`. The
// `db` proxy threads the active transaction through an AsyncLocalStorage context
// (see src/db/index.ts), so the entity lib functions — which use the module
// global `db` — run inside the transaction even on Postgres (where the tx is on
// its own pooled connection). Any throw inside the body rolls back. Audit is
// written ONCE per batch with action=bulk_create / bulk_update so SSE doesn't lie
// about uncommitted work (writeAudit broadcasts unconditionally — pulling
// individual audit calls into the txn body would emit rollback-then-broadcast on
// failure).

function registerProdlistWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "prodlist_upsert",
    {
      description:
        "Idempotent batch upsert of prodlist deliverable rows for the active client. Required: rows (array). Each row needs deliverable_id (the stable source key — re-upserting the same id updates in place, bumping version). Optional per row: production_unit_id, channel (DISP|SOC|PRG|GSN|GNW|YT), campaign, format, required_asset, flight_start, flight_end, source_ref, family_key, mc_number, mc_variant. Atomic single statement. One audit row for the batch. Returns the upserted rows.",
      inputSchema: {
        rows: z.array(
          z.object({
            deliverable_id: z.string().min(1),
            production_unit_id: z.string().optional(),
            channel: z.string().optional(),
            campaign: z.string().optional(),
            format: z.string().optional(),
            required_asset: z.string().optional(),
            flight_start: z.string().optional(),
            flight_end: z.string().optional(),
            source_ref: z.string().optional(),
            family_key: z.string().optional(),
            mc_number: z.number().int().optional(),
            mc_variant: z.string().optional(),
          }),
        ),
      },
    },
    async ({ rows }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      if (rows.length === 0) return jsonResult([]);
      const mapped: ProdlistUpsertRow[] = rows.map((r) => ({
        deliverableId: r.deliverable_id,
        productionUnitId: r.production_unit_id ?? null,
        channel: r.channel ?? null,
        campaign: r.campaign ?? null,
        format: r.format ?? null,
        requiredAsset: r.required_asset ?? null,
        flightStart: r.flight_start ?? null,
        flightEnd: r.flight_end ?? null,
        sourceRef: r.source_ref ?? null,
        familyKey: r.family_key ?? null,
        mcNumber: r.mc_number ?? null,
        mcVariant: r.mc_variant ?? null,
      }));
      const upserted = await upsertProdlistRows(ctx.clientId, mapped);
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "prodlist_rows",
        entityId: `bulk:${ctx.clientId}`,
        action: "bulk_upsert",
        after: { count: upserted.length },
      });
      return jsonResult(upserted);
    },
  );
}

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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = await db.transaction(async () => {
          const out = [];
          for (const it of items) {
            out.push(
              await createAudience(ctx.clientId, {
                name: it.name,
                ...pickAudienceWritable(it.fields ?? {}),
              }),
            );
          }
          return out;
        });
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = await db.transaction(async () => {
          const out = [];
          for (const it of items) {
            out.push(
              await createTopic(ctx.clientId, {
                name: it.name,
                ...pickTopicWritable(it.fields ?? {}),
              }),
            );
          }
          return out;
        });
        await writeAudit({
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
        "Create many messages atomically. Required: messages (array of { audience_key, topic_key, mc_number?, variant?, fields? }). All-or-nothing — rolls back on any failure. Number/variant/version/PMMID auto-assigned per row; mc_number claims a specific MC number for that row (same rules as mc_create: a number already in the target cell adds its next variant; an unused number is created as variant 'a' even in an occupied cell; 'new' forces a brand-new number). The batch creates DIFFERENT MCs — to place one card into many audiences use mc_copy_batch instead (it clones the fields); to relocate cards use mc_move_batch. variant (single letter a–z) pins the exact variant letter for that row (same rules as mc_create).",
      inputSchema: {
        messages: z.array(
          z.object({
            audience_key: z.string(),
            topic_key: z.string(),
            mc_number: z
              .union([z.number().int().positive(), z.literal("new")])
              .optional(),
            variant: z
              .string()
              .regex(/^[a-z]$/, "single lowercase letter a–z")
              .optional(),
            fields: fieldsArg,
          }),
        ),
      },
    },
    async ({ messages: items }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const inserted = await db.transaction(async () => {
          const out = [];
          for (const it of items) {
            out.push(
              await createMessage(
                ctx.clientId,
                {
                  audience: it.audience_key,
                  topic: it.topic_key,
                  ...pickMessageWritable(it.fields ?? {}),
                },
                { requestedNumber: it.mc_number, requestedVariant: it.variant },
              ),
            );
          }
          return out;
        });
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const updated = await db.transaction(async () => {
          const out = [];
          for (const u of updates) {
            const existing = await findMessageByPmmid(ctx.clientId, u.mc_label);
            if (!existing) {
              throw new BatchError(
                `message '${u.mc_label}' not found`,
                u.mc_label,
              );
            }
            const r = await updateMessage(
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
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const result = await db.transaction(async () =>
          copyMessages(ctx.clientId, source_mc_labels, target_audience_keys, {
            fieldOverrides: pickMessageWritable(field_overrides ?? {}),
          }),
        );
        await writeAudit({
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
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const result = await db.transaction(async () =>
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
        await writeAudit({
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

// OpenAI Apps SDK render widget: a resource holding the gallery HTML + a tool
// (show_mc_previews) whose structuredContent the widget renders inline. ChatGPT /
// MCP Inspector interpret the _meta.ui / openai/* fields; other clients just get
// the structuredContent + text.
function registerPreviewWidget(server: McpServer, ctx: McpContext): void {
  const origin = ctx.origin ?? "";
  server.registerResource(
    "mc-preview-widget",
    MC_PREVIEWS_TEMPLATE_URI,
    {
      title: "MC previews gallery",
      description:
        "Inline gallery that renders MC preview images from show_mc_previews output.",
    },
    async () => ({
      contents: [
        {
          uri: MC_PREVIEWS_TEMPLATE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: MC_PREVIEWS_WIDGET_HTML,
          _meta: {
            ui: {
              prefersBorder: true,
              // The widget loads preview PNGs from this deploy's own origin.
              csp: { resourceDomains: origin ? [origin] : [] },
            },
          },
        },
      ],
    }),
  );

  server.registerTool(
    "show_mc_previews",
    {
      title: "Show MC previews",
      description:
        "Render MC preview screenshots as an inline image GALLERY (OpenAI Apps SDK widget) in ChatGPT / MCP Inspector — a visual card, distinct from get_mc_preview_files (which hands raw image bytes to the model). Identify by EXACTLY ONE of mc_label (PMMID) or mc_number. Narrow with: variant (single) OR variants (a list, e.g. [\"b\",\"c\",\"d\"] to show several cards side by side); audience_key; and sizes. sizes DEFAULTS to [\"300x250\"] (the one shown when omitted) — pass other sizes explicitly (e.g. [\"970x250\",\"300x600\"]) or [\"all\"] for every generated size. Distinct variants are each shown; the same variant fanned out across audiences is collapsed to one (identical creative). Returns structuredContent { name, previews:[{label,size,url}] } with absolute, public preview URLs; non-widget clients still get that data + a text summary.",
      inputSchema: {
        mc_label: z.string().optional(),
        mc_number: z.number().int().optional(),
        variant: z.string().optional(),
        variants: z.array(z.string()).optional(),
        audience_key: z.string().optional(),
        sizes: z.array(z.string()).optional(),
      },
      outputSchema: {
        name: z.string(),
        previews: z.array(
          z.object({
            label: z.string(),
            size: z.string(),
            url: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: MC_PREVIEWS_TEMPLATE_URI },
        "openai/outputTemplate": MC_PREVIEWS_TEMPLATE_URI,
        "openai/toolInvocation/invoking": "Loading previews…",
        "openai/toolInvocation/invoked": "Previews loaded.",
      },
    },
    async (args) => {
      const hasLabel = args.mc_label !== undefined;
      const hasNumber = args.mc_number !== undefined;
      if (hasLabel === hasNumber) {
        return errorResult("provide exactly one of mc_label or mc_number");
      }
      if ((args.variant !== undefined || args.variants !== undefined) && !hasNumber) {
        return errorResult("variant / variants can only be used with mc_number");
      }
      if (args.variant !== undefined && args.variants !== undefined) {
        return errorResult("provide variant OR variants, not both");
      }
      const conds = [
        eq(messages.clientId, ctx.clientId),
        isNull(messages.archivedAt),
      ];
      if (hasLabel) conds.push(eq(messages.pmmid, args.mc_label!));
      if (hasNumber) conds.push(eq(messages.number, args.mc_number!));
      if (args.variant !== undefined)
        conds.push(eq(messages.variant, args.variant));
      if (args.variants !== undefined && args.variants.length > 0)
        conds.push(inArray(messages.variant, args.variants));
      if (args.audience_key !== undefined)
        conds.push(eq(messages.audience, args.audience_key));
      const mcs = await db
        .select({
          id: messages.id,
          number: messages.number,
          variant: messages.variant,
          pmmid: messages.pmmid,
          name: messages.name,
        })
        .from(messages)
        .where(and(...conds))
        .orderBy(messages.number, messages.variant);
      if (mcs.length === 0) return errorResult("no MC matched the query");
      const metaById = new Map(mcs.map((m) => [m.id, m]));

      const pconds = [
        eq(messagePreviews.clientId, ctx.clientId),
        inArray(
          messagePreviews.messageId,
          mcs.map((m) => m.id),
        ),
      ];
      // Default to 300x250 only; pass explicit sizes for others, or ["all"] for
      // every generated size.
      let sizeFilter: string[] | null;
      if (!args.sizes || args.sizes.length === 0) sizeFilter = ["300x250"];
      else if (args.sizes.includes("all")) sizeFilter = null;
      else sizeFilter = args.sizes;
      if (sizeFilter) pconds.push(inArray(messagePreviews.size, sizeFilter));
      const previewRows = await db
        .select({
          id: messagePreviews.id,
          messageId: messagePreviews.messageId,
          size: messagePreviews.size,
          updatedAt: messagePreviews.updatedAt,
        })
        .from(messagePreviews)
        .where(and(...pconds))
        // Newest first, so the (variant,size) dedup below keeps the most recently
        // reshot copy. Fan-out cells have separate preview rows regenerated at
        // different times — picking the first-by-id could keep a stale copy while
        // a fresher one (higher updated_at) exists.
        .orderBy(desc(messagePreviews.updatedAt), desc(messagePreviews.id));

      // Dedup by (variant, size): the same variant fanned out across audience
      // cells renders the identical creative, so collapse it (keeping the newest
      // per above) — but keep DISTINCT variants (b/c/d are different creatives).
      const seen = new Set<string>();
      const previews: { label: string; size: string; url: string; _v: string }[] = [];
      for (const p of previewRows) {
        const meta = metaById.get(p.messageId)!;
        const key = `${meta.variant}|${p.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        previews.push({
          label: `MC${meta.number}${meta.variant}`,
          size: p.size,
          url: previewUrl(origin, p.id, p.updatedAt),
          _v: meta.variant,
        });
      }
      previews.sort(
        (a, b) => a._v.localeCompare(b._v) || a.size.localeCompare(b.size),
      );
      const clean = previews.map(({ label, size, url }) => ({ label, size, url }));

      // Title: a single variant keeps its campaign name; multiple distinct
      // variants have different names, so list their labels instead (no em-dash).
      const distinctLabels = [...new Set(clean.map((p) => p.label))];
      const nm = mcs[0]!.name;
      const name =
        distinctLabels.length === 1
          ? nm
            ? `${distinctLabels[0]} · ${nm}`
            : distinctLabels[0]!
          : distinctLabels.join(", ");

      return {
        structuredContent: { name, previews: clean },
        content: [
          {
            type: "text" as const,
            text: clean.length
              ? `${clean.length} preview(s): ${clean
                  .map((p) => `${p.label} ${p.size}`)
                  .join(", ")}.`
              : `No generated previews matched — run preview_generate first (with force after a template/copy change).`,
          },
        ],
      };
    },
  );
}

// ── Drafts and briefs ──
// The agentic intake path. A draft is a `messages` row with NO AUDIENCE, so it
// is outside the matrix but inside every other message mechanism — most of all
// numbering: generate_test_creative claims the MC number immediately, and
// nothing else can take it while the work is in progress. Previews are ordinary
// message previews, so render progress is DERIVED from which sizes have a
// fresh row (draft_status) rather than stored in a job table.
// Promotion (draft_promote) gives the draft its cell and keeps its number.

function draftSummary(d: Message) {
  return {
    draft_id: d.id,
    mc_label: `MC${d.number}${d.variant}`,
    mc_number: d.number,
    variant: d.variant,
    name: d.name,
    template: d.template,
    template_variant_classes: d.templateVariantClasses,
    sizes: draftSizes(d),
    working_topic: d.topic,
    brief_slides_file_id: d.briefSlidesFileId,
    version: d.version,
    created_at: d.createdAt,
  };
}

function registerDraftReadTools(server: McpServer, ctx: McpContext): void {
  const origin = ctx.origin ?? "";
  const previewList = (previews: DraftPreviewRow[], version: number) =>
    previews
      .slice()
      .sort((a, b) => a.size.localeCompare(b.size))
      .map((p) => ({
        size: p.size,
        url: draftPreviewUrl(origin, p.id, p.updatedAt),
        ...(p.messageVersion === version ? {} : { stale: true }),
      }));

  server.registerTool(
    "list_drafts",
    {
      description:
        "List drafts — work that has been taken on and has CLAIMED ITS MC NUMBER, but has no cell in the matrix yet (no audience). Returns lean rows: draft_id, mc_label, mc_number, variant, name, template, sizes, working_topic (a suggested name, not a topics key), brief_slides_file_id, version, created_at. Newest first, default limit 500 (max 1000). Promoted drafts are not listed — once placed they are ordinary MCs, so use list_mc.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async ({ limit }) => {
      const rows = await listDrafts(ctx.clientId);
      return jsonResult(rows.slice(0, limit ?? 500).map(draftSummary));
    },
  );

  server.registerTool(
    "draft_get",
    {
      description:
        "Get one draft with every content field (headline, copy1/copy2, disclaimer, cta, flash/sticker text, styles, customCss, image1..6), its claimed MC number, its brief link, and its preview URLs. A preview marked stale was shot before the draft's current version. Required: draft_id.",
      inputSchema: { draft_id: z.number().int() },
    },
    async ({ draft_id }) => {
      const draft = await getMessage(ctx.clientId, draft_id);
      if (!draft || draft.status !== "DRAFT") {
        return errorResult(`draft ${draft_id} not found`);
      }
      const previews =
        (await listDraftPreviews(ctx.clientId, [draft_id])).get(draft_id) ?? [];
      return jsonResult({
        ...draft,
        draft_id: draft.id,
        mc_label: `MC${draft.number}${draft.variant}`,
        sizes: draftSizes(draft),
        previews: previewList(previews, draft.version),
      });
    },
  );

  server.registerTool(
    "draft_status",
    {
      description:
        "Poll the render progress of a draft. Returns { status, total_sizes, done_sizes, percent, previews, stale_sizes }. status: pending|rendering|done. Progress is DERIVED — a size counts as done when its preview was shot at the draft's current version — so editing a draft makes its previews stale again and the percentage drops back, which is the same staleness rule the matrix uses. If the count stops climbing, the render died with the server process: call generate_test_creative's render again by editing nothing and re-shooting via preview_generate once the draft is promoted, or recreate the draft. Polling does NOT count against the write rate limit.",
      inputSchema: { draft_id: z.number().int() },
    },
    async ({ draft_id }) => {
      const s = await getDraftStatus(ctx.clientId, draft_id);
      if (!s) return errorResult(`draft ${draft_id} not found`);
      const draft = await getMessage(ctx.clientId, draft_id);
      return jsonResult({
        draft_id,
        status: s.status,
        total_sizes: s.totalSizes,
        done_sizes: s.doneSizes,
        percent: s.percent,
        stale_sizes: s.staleSizes,
        previews: previewList(s.previews, draft?.version ?? 0),
      });
    },
  );

  server.registerTool(
    "list_briefs",
    {
      description:
        "List briefs — the Google Slides decks work came in on, derived from the cards themselves. A brief is not a stored entity: it is the Drive FILE ID on each card (slides_file_id), which is the deck's identity because the editor link, the Drive link and a link with a #slide fragment all normalise to it. Each row carries slides_file_id, its editor url, and the progress counts open_drafts / promoted, which answer 'what came of this brief?' and are counted from the work itself, so they cannot drift. A deck no card points at is not listed — there is nothing left to list.",
      inputSchema: {},
    },
    async () => {
      const rows = await listBriefDecks(ctx.clientId);
      return jsonResult(
        rows.map((b) => ({
          slides_file_id: b.slidesFileId,
          url: `https://docs.google.com/presentation/d/${b.slidesFileId}/edit`,
          open_drafts: b.openDrafts,
          promoted: b.promoted,
        })),
      );
    },
  );

  server.registerTool(
    "show_draft_previews",
    {
      title: "Show draft previews",
      description:
        'Render a draft\'s generated PNGs as an inline image GALLERY (OpenAI Apps SDK widget) in ChatGPT / MCP Inspector — same visual card as show_mc_previews, fed from a draft. Required: draft_id. Optional: sizes to narrow (default: every size rendered so far). Returns structuredContent { name, previews:[{label,size,url}] } with absolute, public preview URLs; non-widget clients still get that data + a text summary.',
      inputSchema: {
        draft_id: z.number().int(),
        sizes: z.array(z.string()).optional(),
      },
      outputSchema: {
        name: z.string(),
        previews: z.array(
          z.object({
            label: z.string(),
            size: z.string(),
            url: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: MC_PREVIEWS_TEMPLATE_URI },
        "openai/outputTemplate": MC_PREVIEWS_TEMPLATE_URI,
        "openai/toolInvocation/invoking": "Loading previews…",
        "openai/toolInvocation/invoked": "Previews loaded.",
      },
    },
    async ({ draft_id, sizes }) => {
      const draft = await getMessage(ctx.clientId, draft_id);
      if (!draft || draft.status !== "DRAFT") {
        return errorResult(`draft ${draft_id} not found`);
      }
      const all =
        (await listDraftPreviews(ctx.clientId, [draft_id])).get(draft_id) ?? [];
      const wanted =
        sizes && sizes.length > 0
          ? all.filter((p) => sizes.includes(p.size))
          : all;
      const label = draft.name ?? `MC${draft.number}${draft.variant}`;
      const previews = wanted
        .map((p) => ({
          label,
          size: p.size,
          url: draftPreviewUrl(origin, p.id, p.updatedAt),
        }))
        .sort((a, b) => a.size.localeCompare(b.size));
      return {
        structuredContent: { name: label, previews },
        content: [
          {
            type: "text" as const,
            text: previews.length
              ? `${previews.length} preview(s): ${previews
                  .map((p) => `${p.label} ${p.size}`)
                  .join(", ")}.`
              : `No previews rendered yet for draft ${draft_id} — poll draft_status until done.`,
          },
        ],
      };
    },
  );
}

function registerDraftWriteTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "generate_test_creative",
    {
      description:
        "Take work on: stage a draft creative and render it to PNG previews. The draft is OUTSIDE the matrix (no audience, no cell) but it CLAIMS ITS MC NUMBER immediately, and nothing else can take that number while the work is in progress — that is the point of starting here rather than in the matrix. Required: template (an html template from list_templates). Optional sizes narrows the initial render (default: every size the template defines); they must be sizes that template has. Content fields: headline, copy1, copy2, disclaimer, cta, flash (the sticker TEXT), per-field *_style CSS, custom_css, and template_variant_classes (space-separated layout/color/frame tokens from the template's tag options, e.g. 'fullSurfaceImage teal topSticker' — list_templates shows the valid vocabulary). Images are referenced by STORED FILENAME (upload generated images first via asset_upload): background_images (up to 4 → image1..4), brand_image (logo → image5, template default when omitted), sticker_image (→ image6). Optional brief_link records the Google Slides deck (and slide) this came in on — the Drive file id is what gets stored, so three spellings of one link are one deck, and working_topic records a suggested topic NAME that promotion later resolves to a real topic. All inputs are validated up front — a validation error lists every problem at once and creates nothing. Rendering is ASYNC: this returns immediately with draft_id and the claimed mc_label; poll draft_status for progress. The call is NOT idempotent — before retrying a timeout, check list_drafts to avoid claiming a second number. One write against the rate limit. Then: show_draft_previews to display, draft_promote to give it a cell, draft_archive to shelve it.",
      inputSchema: {
        template: z.string(),
        sizes: z.array(z.string()).optional(),
        name: z.string().optional(),
        working_topic: z.string().optional(),
        brief_link: z.string().optional(),
        template_variant_classes: z.string().optional(),
        headline: z.string().optional(),
        copy1: z.string().optional(),
        copy2: z.string().optional(),
        disclaimer: z.string().optional(),
        cta: z.string().optional(),
        flash: z.string().optional(),
        headline_style: z.string().optional(),
        copy1_style: z.string().optional(),
        copy2_style: z.string().optional(),
        disclaimer_style: z.string().optional(),
        cta_style: z.string().optional(),
        flash_style: z.string().optional(),
        custom_css: z.string().optional(),
        background_images: z.array(z.string()).max(4).optional(),
        brand_image: z.string().optional(),
        sticker_image: z.string().optional(),
      },
    },
    async (args) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const bg = args.background_images ?? [];
      const input: TestCreativeInput = {
        template: args.template,
        sizes: args.sizes,
        name: args.name,
        templateVariantClasses: args.template_variant_classes,
        headline: args.headline,
        copy1: args.copy1,
        copy2: args.copy2,
        disclaimer: args.disclaimer,
        cta: args.cta,
        flash: args.flash,
        headlineStyle: args.headline_style,
        copy1Style: args.copy1_style,
        copy2Style: args.copy2_style,
        disclaimerStyle: args.disclaimer_style,
        ctaStyle: args.cta_style,
        flashStyle: args.flash_style,
        customCss: args.custom_css,
        image1: bg[0],
        image2: bg[1],
        image3: bg[2],
        image4: bg[3],
        image5: args.brand_image,
        image6: args.sticker_image,
      };
      try {
        const { draft, sizes } = await createTestCreative(ctx.clientId, input);
        // The brief and the working topic are applied after creation so a bad
        // link fails loudly on its own rather than silently losing the draft.
        let row = draft;
        if (args.brief_link || args.working_topic) {
          const fileId = args.brief_link
            ? briefFileIdFromLink(args.brief_link)
            : null;
          const res = await updateMessage(ctx.clientId, draft.id, draft.version, {
            ...(fileId
              ? {
                  briefSlidesFileId: fileId,
                  briefSlideId: parseSlideAnchor(args.brief_link!),
                }
              : {}),
            ...(args.working_topic ? { topic: args.working_topic } : {}),
          });
          if (res.ok) row = res.row;
        }
        // Fire-and-forget: progress is read back off the preview rows, so a
        // render that dies with the process just leaves those sizes missing.
        void startDraftRender(ctx.clientId, row.id, sizes).catch((e) =>
          console.error(`[drafts] render of draft ${row.id} failed:`, e),
        );
        await writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: row.id,
          action: "create",
          after: row,
        });
        return jsonResult({
          ...draftSummary(row),
          rendering_sizes: sizes,
          hint: "poll draft_status until done, then draft_promote to place it",
        });
      } catch (e) {
        if (e instanceof DraftError || e instanceof BriefError) {
          return errorResult(e.message);
        }
        throw e;
      }
    },
  );

  server.registerTool(
    "brief_attach",
    {
      description:
        "Record which Google Slides deck — and which SLIDE of it — a card was briefed on. Both are stored ON the card: the Drive FILE ID parsed out of the link (so the editor link, the Drive link and a link with a #slide fragment are one deck, not three) and the page object id from a `#slide=id.g…` anchor when the link carries one. A brief is not a separate entity, so there is nothing to attach to but a card: draft_id (or any message id) is REQUIRED. A folder link is refused. Pass an empty link to detach. One write against the rate limit.",
      inputSchema: {
        link: z.string(),
        draft_id: z.number().int(),
      },
    },
    async ({ link, draft_id }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      try {
        const trimmed = link.trim();
        const fileId = trimmed ? briefFileIdFromLink(trimmed) : null;
        const draft = await getMessage(ctx.clientId, draft_id);
        if (!draft) return errorResult(`message ${draft_id} not found`);
        const res = await updateMessage(ctx.clientId, draft_id, draft.version, {
          briefSlidesFileId: fileId,
          briefSlideId: trimmed ? parseSlideAnchor(trimmed) : null,
        });
        if (!res.ok) {
          return errorResult("version_conflict", { current: res.current });
        }
        await writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: draft_id,
          action: "update",
          before: draft,
          after: res.row,
        });
        return jsonResult({
          message_id: draft_id,
          slides_file_id: res.row.briefSlidesFileId,
          slide_id: res.row.briefSlideId,
        });
      } catch (e) {
        if (e instanceof BriefError) return errorResult(e.message);
        throw e;
      }
    },
  );

  server.registerTool(
    "draft_archive",
    {
      description:
        "Shelve a draft: the row is ARCHIVED and its MC number STAYS RETIRED, exactly as it does for any archived card, so a shelved draft can never have its number silently reused. Called `draft_delete` until 6.71.0 — that name promised something it never did. Nothing here deletes: the UI's Delete button (for a draft created by mistake, whose number should come back) has no MCP equivalent on purpose — an agent that can hard-delete rows is a different risk from one that can shelve them. Required: draft_id. Optional: version for optimistic locking (omitted = current). One write against the rate limit.",
      inputSchema: {
        draft_id: z.number().int(),
        version: z.number().int().optional(),
      },
    },
    async ({ draft_id, version }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const existing = await getMessage(ctx.clientId, draft_id);
      if (!existing || existing.status !== "DRAFT") {
        return errorResult(`draft ${draft_id} not found`);
      }
      const res = await archiveMessage(
        ctx.clientId,
        draft_id,
        version ?? existing.version,
      );
      if (!res.ok) {
        return errorResult("version_conflict", { current: res.current });
      }
      await writeAudit({
        clientId: ctx.clientId,
        userId: mcpUserId(ctx),
        entityType: "messages",
        entityId: draft_id,
        action: "archive",
        before: existing,
        after: res.row,
      });
      return jsonResult({ ok: true, archived: draft_id });
    },
  );

  server.registerTool(
    "draft_promote",
    {
      description:
        "Give a draft its cell: sets (audience_key, topic_key) and moves it out of DRAFT, generating the PMMID and trafficking columns. The MC NUMBER IS KEPT — that is the promise made when the draft claimed it — and the row is UPDATED rather than replaced, so the number, the brief link and the edit history all survive. The variant only shifts if the target cell already holds this number. The topic must already exist: promotion never creates one, because a promote that minted topics would fill the dimension with near-duplicate spellings. To reach BOTH axes (a static image and a DCO feed row) under one number, promote onto one axis and then mc_copy across to the other. One write against the rate limit. Returns the placed message.",
      inputSchema: {
        draft_id: z.number().int(),
        audience_key: z.string(),
        topic_key: z.string(),
        status: z.string().optional(),
        version: z.number().int().optional(),
      },
    },
    async ({ draft_id, audience_key, topic_key, status, version }) => {
      const limited = await requireRate(ctx);
      if (limited) return limited;
      const before = await getMessage(ctx.clientId, draft_id);
      try {
        const row = await promoteDraft(ctx.clientId, draft_id, {
          audienceKey: audience_key,
          topicKey: topic_key,
          status,
          expectedVersion: version,
        });
        await writeAudit({
          clientId: ctx.clientId,
          userId: mcpUserId(ctx),
          entityType: "messages",
          entityId: row.id,
          action: "update",
          before,
          after: row,
        });
        return jsonResult({ message: row });
      } catch (e) {
        if (e instanceof MessageError) return errorResult(e.message);
        throw e;
      }
    },
  );
}

export function buildMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "messagingmatrix", version: "6.0.0-pre" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerReadTools(server, ctx);
  registerMetaTools(server, ctx);
  registerPreviewWidget(server, ctx);
  registerDraftReadTools(server, ctx);
  // Read-scoped tokens never see the write tools: unregistered tools are
  // invisible to tools/list and rejected at the protocol layer.
  if (ctx.scope === "full") {
    registerAudienceWriteTools(server, ctx);
    registerTopicWriteTools(server, ctx);
    registerMessageWriteTools(server, ctx);
    registerAssetWriteTools(server, ctx);
    registerCreativeWriteTools(server, ctx);
    registerProdlistWriteTools(server, ctx);
    registerDraftWriteTools(server, ctx);
    registerBatchTools(server, ctx);
  }
  return server;
}
