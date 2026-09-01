import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { audiences, creatives, messages, uploadedFiles } from "@/db/schema";
import { groupCreativeVersions } from "@/lib/group-creative-versions";
import { listAllTemplates } from "@/lib/templates";
import type { DayScope } from "@/lib/day-scope";

/**
 * The two formats the strip shows. A delivery arrives in a dozen sizes; on a
 * dashboard the point is to recognize the creative, not to audit the set, so
 * one landscape banner and one square is what goes out. The rest stay one
 * click away in the Creative Library.
 */
export const STRIP_SIZES = ["300x250", "1080x1080"];

export type StripCreative = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  template: string | null;
  bannerVersion: string | null;
  visualKeyword: string | null;
  copyKeyword: string | null;
  mcNumber: number | null;
  mcVariant: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileSize: string | null;
  fileDimensions: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StripFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

export type StripMessage = typeof messages.$inferSelect;

/** An uploaded creative — a delivered file in the Creative Library. */
export type UploadedStripItem = {
  kind: "uploaded";
  id: number;
  changedAt: string;
  mcLabel: string | null;
  topic: string | null;
  creative: StripCreative;
  file: StripFile | null;
};

/** A DCO banner — the matrix cell rendered live through its template. */
export type McStripItem = {
  kind: "mc";
  /** Negative, like the Creative Library's matrix items, so one list of ids
   *  can hold both kinds without collisions. */
  id: number;
  changedAt: string;
  mcLabel: string;
  topic: string;
  size: string;
  template: string;
  product: string | null;
  message: StripMessage;
};

export type StripItem = UploadedStripItem | McStripItem;

export type StripPage = {
  items: StripItem[];
  /** Source rows the window holds (a message can render more than one tile). */
  total: number;
  /** True when the window held nothing and this is the latest-changed list. */
  fallback: boolean;
  nextOffset: number | null;
};

export const STRIP_PAGE = 24;

/** Templates that render at least one of the strip's two sizes. */
function stripTemplates(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of listAllTemplates()) {
    const sizes = t.sizes.filter((s) => STRIP_SIZES.includes(s));
    if (sizes.length > 0) out.set(t.name, sizes);
  }
  return out;
}

/**
 * One page of the dashboard creative strip: uploaded creatives and DCO matrix
 * banners in one list, newest change first.
 *
 * Ordered by `updatedAt` — the last change, which is what the strip claims to
 * show. Not by id: this library's highest ids are an import whose rows are
 * years old, so id order leads with the oldest delivery. Not by `createdAt`
 * either: that is when the creative first arrived, and a re-upload, a
 * re-tagging or a copy edit is exactly the change worth surfacing.
 *
 * Paging is by SOURCE ROW, not by tile: a message renders one tile per strip
 * size its template carries, so a page can hand back more tiles than its
 * limit. The alternative — paging by tile — would need the template fan-out
 * inside SQL.
 */
export async function listStripCreatives(
  clientId: number,
  scope: DayScope,
  offset = 0,
  limit = STRIP_PAGE,
): Promise<StripPage> {
  const templates = stripTemplates();
  const templateNames = [...templates.keys()];

  const liveCreative = and(
    eq(creatives.clientId, clientId),
    isNull(creatives.archivedAt),
    inArray(creatives.fileDimensions, STRIP_SIZES),
  );
  // Same rule the Creative Library applies to its matrix tiles: live cells
  // only, and only templates that actually render at one of these sizes.
  const liveMessage = and(
    eq(messages.clientId, clientId),
    isNull(messages.archivedAt),
    eq(sql`upper(${messages.status})`, "ACTIVE"),
    templateNames.length > 0
      ? inArray(messages.template, templateNames)
      : sql`false`,
  );

  const windowed = (base: ReturnType<typeof and>, col: PgColumn) =>
    and(base, gte(col, scope.from), lte(col, scope.to));

  const inWindow = await sourceCount(
    windowed(liveCreative, creatives.updatedAt),
    windowed(liveMessage, messages.updatedAt),
  );
  const fallback = inWindow === 0;
  const total = fallback
    ? await sourceCount(liveCreative, liveMessage)
    : inWindow;

  const creativeWhere = fallback
    ? liveCreative
    : windowed(liveCreative, creatives.updatedAt);
  const messageWhere = fallback
    ? liveMessage
    : windowed(liveMessage, messages.updatedAt);

  // Two sources, one recency line: the union decides the order and the page
  // boundary, then each kind is hydrated with what its tile and dialog need.
  // The messages side is DISTINCT ON (number, variant) because one MC lives in
  // as many cells as it has audiences — the Creative Library collapses those
  // to one tile too, and without it a single edited MC fills the whole strip.
  const cursor = (await db.execute<{
    kind: string;
    row_id: number;
    changed_at: string;
  }>(sql`
    select kind, row_id, changed_at from (
      select 'uploaded' as kind, ${creatives.id} as row_id,
             ${creatives.updatedAt} as changed_at
      from ${creatives}
      where ${creativeWhere}
      union all
      select 'mc' as kind, m.id as row_id, m.updated_at as changed_at
      from (
        select distinct on (${messages.number}, ${messages.variant})
               ${messages.id} as id, ${messages.updatedAt} as updated_at
        from ${messages}
        where ${messageWhere}
        order by ${messages.number}, ${messages.variant},
                 ${messages.updatedAt} desc, ${messages.id} desc
      ) m
    ) u
    order by changed_at desc, kind, row_id desc
    limit ${limit} offset ${offset}
  `)) as unknown as Array<{ kind: string; row_id: number; changed_at: string }>;

  const creativeIds = cursor.filter((r) => r.kind === "uploaded").map((r) => r.row_id);
  const messageIds = cursor.filter((r) => r.kind === "mc").map((r) => r.row_id);

  const [uploadedItems, mcItems] = await Promise.all([
    hydrateUploaded(clientId, creativeIds),
    hydrateMc(clientId, messageIds, templates),
  ]);

  const byKey = new Map<string, StripItem[]>();
  for (const i of uploadedItems) byKey.set(`uploaded:${i.creative.id}`, [i]);
  for (const i of mcItems) {
    const key = `mc:${i.message.id}`;
    const cur = byKey.get(key);
    if (cur) cur.push(i);
    else byKey.set(key, [i]);
  }
  const items = cursor.flatMap((r) => byKey.get(`${r.kind}:${r.row_id}`) ?? []);

  const consumed = offset + cursor.length;
  return {
    items,
    total,
    fallback,
    nextOffset: cursor.length === limit && consumed < total ? consumed : null,
  };
}

// Source rows, counted the way the cursor selects them — messages by distinct
// MC, not by cell, or the total would promise tiles the strip never renders.
async function sourceCount(
  creativeWhere: ReturnType<typeof and>,
  messageWhere: ReturnType<typeof and>,
): Promise<number> {
  const [c, m] = await Promise.all([
    db.select({ n: count() }).from(creatives).where(creativeWhere),
    db
      .selectDistinct({ number: messages.number, variant: messages.variant })
      .from(messages)
      .where(messageWhere),
  ]);
  return (c[0]?.n ?? 0) + m.length;
}

async function hydrateUploaded(
  clientId: number,
  ids: number[],
): Promise<UploadedStripItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ creative: creatives, file: uploadedFiles })
    .from(creatives)
    .leftJoin(uploadedFiles, eq(creatives.fileId, uploadedFiles.id))
    .where(and(eq(creatives.clientId, clientId), inArray(creatives.id, ids)));

  // Versions of one file differ only in the _nN token and are uploaded
  // together, so they land in the same page — collapsing them here keeps the
  // strip from showing n1 beside n2. Families that straddle a page boundary
  // are left alone: paging by group would make the offset depend on parsing,
  // and the strip is a glance, not an inventory.
  const latestOfFamily = new Set(
    groupCreativeVersions(rows.map((r) => r.creative)).map((g) => g.latest.id),
  );

  const items: UploadedStripItem[] = rows
    .filter((r) => latestOfFamily.has(r.creative.id))
    .map((r) => ({
      kind: "uploaded" as const,
      id: r.creative.id,
      changedAt: r.creative.updatedAt,
      mcLabel:
        r.creative.mcNumber !== null
          ? `MC${r.creative.mcNumber}${r.creative.mcVariant ?? ""}`
          : null,
      topic: null,
      creative: r.creative,
      file: r.file
        ? {
            id: r.file.id,
            filename: r.file.filename,
            mimeType: r.file.mimeType,
            sizeBytes: r.file.sizeBytes,
            dimensions: r.file.dimensions,
          }
        : null,
    }));

  await attachTopics(clientId, items);
  return items;
}

async function hydrateMc(
  clientId: number,
  ids: number[],
  templates: Map<string, string[]>,
): Promise<McStripItem[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ message: messages, product: audiences.product })
    .from(messages)
    .leftJoin(
      audiences,
      and(
        eq(audiences.clientId, messages.clientId),
        eq(audiences.key, messages.audience),
      ),
    )
    .where(and(eq(messages.clientId, clientId), inArray(messages.id, ids)));

  const out: McStripItem[] = [];
  for (const r of rows) {
    const sizes = r.message.template ? (templates.get(r.message.template) ?? []) : [];
    sizes.forEach((size, i) => {
      out.push({
        kind: "mc",
        // The Creative Library's own scheme for matrix ids — negative, and
        // spaced by size index so one message's sizes stay distinct.
        id: -(r.message.id * 1000 + i + 1),
        changedAt: r.message.updatedAt,
        mcLabel: `MC${r.message.number}${r.message.variant}`,
        topic: r.message.topic,
        size,
        template: r.message.template!,
        product: r.product ?? null,
        message: r.message,
      });
    });
  }
  return out;
}

/**
 * Creatives carry an MC number and variant but no topic — the topic lives on
 * the message. Most number+variant pairs resolve to exactly one topic; the few
 * that fan out list every one, because picking one silently would name the
 * wrong cell.
 */
async function attachTopics(
  clientId: number,
  items: UploadedStripItem[],
): Promise<void> {
  const pairs = items
    .map((i) => i.creative)
    .filter((c) => c.mcNumber !== null)
    .map((c) => ({ number: c.mcNumber!, variant: c.mcVariant ?? "" }));
  if (pairs.length === 0) return;

  const rows = await db
    .selectDistinct({
      number: messages.number,
      variant: messages.variant,
      topic: messages.topic,
    })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        isNull(messages.archivedAt),
        or(
          ...pairs.map((p) =>
            and(eq(messages.number, p.number), eq(messages.variant, p.variant)),
          ),
        ),
      ),
    );

  const byPair = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.number}|${r.variant}`;
    const cur = byPair.get(key);
    if (cur) cur.push(r.topic);
    else byPair.set(key, [r.topic]);
  }
  for (const item of items) {
    const c = item.creative;
    if (c.mcNumber === null) continue;
    const topics = byPair.get(`${c.mcNumber}|${c.mcVariant ?? ""}`);
    item.topic = topics ? topics.join(" · ") : null;
  }
}
