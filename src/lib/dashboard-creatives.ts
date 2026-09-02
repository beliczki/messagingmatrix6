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
import {
  audiences,
  creatives,
  messages,
  monitoring,
  uploadedFiles,
} from "@/db/schema";
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

/** How the strip is ordered. */
export type StripSort = "time" | "ctr";

/**
 * Impressions an MC must have delivered before its CTR is allowed to rank it.
 *
 * A creative that ran twice and was clicked once reads as a 50% CTR; without a
 * floor the top of the list is noise. 100k is where the rate stops moving on
 * this account's volumes.
 */
export const CTR_MIN_IMPRESSIONS = 100_000;

/**
 * Measured CTR per MC, as a subquery: matched monitoring rows only, summed over
 * every report period, and only MCs past the impression floor.
 *
 * Matched only, because an unmatched row is by definition not attributable to
 * the MC whose tile would be ranked by it. All periods rather than the day
 * scope, because the scope is a day and monitoring keeps months — an MC's rate
 * is a property of its whole run, not of the window the strip is showing.
 */
function mcPerformance() {
  return sql`(
    select ${monitoring.mcNumber} as mc_number,
           ${monitoring.mcVariant} as mc_variant,
           sum(${monitoring.clicks})::float8 / sum(${monitoring.impressions}) as ctr
    from ${monitoring}
    where ${monitoring.messageId} is not null
    group by ${monitoring.mcNumber}, ${monitoring.mcVariant}
    having sum(${monitoring.impressions}) >= ${CTR_MIN_IMPRESSIONS}
  )`;
}

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
 *
 * `sort: "ctr"` reorders by measured click-through instead, and narrows the
 * list to the MCs that have earned a rate worth ranking — see `mcPerformance`.
 */
export async function listStripCreatives(
  clientId: number,
  scope: DayScope,
  offset = 0,
  limit = STRIP_PAGE,
  products: string[] = [],
  sort: StripSort = "time",
): Promise<StripPage> {
  const templates = stripTemplates();
  const templateNames = [...templates.keys()];

  // Ranking by CTR also NARROWS the strip: an MC with no matched reporting, or
  // with too little of it to trust, has no rate to be ranked by and drops out
  // rather than trailing the list on a null.
  const perf = sort === "ctr" ? mcPerformance() : null;
  const ctrOf = (num: PgColumn, variant: PgColumn) =>
    sql`(select p.ctr from ${perf} p
          where p.mc_number = ${num} and p.mc_variant = ${variant})`;
  const rankedOnly = (num: PgColumn, variant: PgColumn) =>
    perf
      ? sql`(${num}, ${variant}) in (select p.mc_number, p.mc_variant from ${perf} p)`
      : undefined;

  // A product narrows both sources, but it reaches them differently: a
  // creative carries its own product column, while a cell's product hangs off
  // its audience.
  const productKeys = products.length
    ? db
        .select({ key: audiences.key })
        .from(audiences)
        .where(
          and(
            eq(audiences.clientId, clientId),
            inArray(audiences.product, products),
          ),
        )
    : null;

  const liveCreative = and(
    eq(creatives.clientId, clientId),
    isNull(creatives.archivedAt),
    inArray(creatives.fileDimensions, STRIP_SIZES),
    products.length ? inArray(creatives.product, products) : undefined,
    rankedOnly(creatives.mcNumber, creatives.mcVariant),
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
    productKeys ? inArray(messages.audience, productKeys) : undefined,
    rankedOnly(messages.number, messages.variant),
  );

  const windowed = (base: ReturnType<typeof and>, col: PgColumn) =>
    and(base, gte(col, scope.from), lte(col, scope.to));

  // Ranking by CTR drops the day window entirely. The rate is measured over
  // whole report periods, and on live data the window would gut the list: of
  // the 74 MCs past the impression floor, a 7-day window holds 9 — and no
  // uploaded creative at all. "Best performing" is an all-time question.
  const inWindow =
    sort === "ctr"
      ? 0
      : await sourceCount(
          windowed(liveCreative, creatives.updatedAt),
          windowed(liveMessage, messages.updatedAt),
        );
  const windowless = sort === "ctr" || inWindow === 0;
  // `fallback` says "the window was empty, so this is the latest-changed list"
  // — never true on the CTR ordering, which does not claim a window at all.
  const fallback = sort !== "ctr" && inWindow === 0;
  const total = windowless
    ? await sourceCount(liveCreative, liveMessage)
    : inWindow;

  const creativeWhere = windowless
    ? liveCreative
    : windowed(liveCreative, creatives.updatedAt);
  const messageWhere = windowless
    ? liveMessage
    : windowed(liveMessage, messages.updatedAt);

  // Two sources, one recency line: the union decides the order and the page
  // boundary, then each kind is hydrated with what its tile and dialog need.
  // The messages side is DISTINCT ON (number, variant) because one MC lives in
  // as many cells as it has audiences — the Creative Library collapses those
  // to one tile too, and without it a single edited MC fills the whole strip.
  // `rate` is null on the time ordering and never selected for; on the CTR
  // ordering both branches carry the MC's measured rate and it leads the sort,
  // with the recency line kept as the tiebreaker.
  const rate = perf
    ? {
        uploaded: ctrOf(creatives.mcNumber, creatives.mcVariant),
        mc: sql`(select p.ctr from ${perf} p
                  where p.mc_number = m.number and p.mc_variant = m.variant)`,
      }
    : { uploaded: sql`null::float8`, mc: sql`null::float8` };
  const order = perf
    ? sql`order by rate desc nulls last, changed_at desc, kind, row_id desc`
    : sql`order by changed_at desc, kind, row_id desc`;

  const cursor = (await db.execute<{
    kind: string;
    row_id: number;
    changed_at: string;
  }>(sql`
    select kind, row_id, changed_at from (
      select 'uploaded' as kind, ${creatives.id} as row_id,
             ${creatives.updatedAt} as changed_at,
             ${rate.uploaded} as rate
      from ${creatives}
      where ${creativeWhere}
      union all
      select 'mc' as kind, m.id as row_id, m.updated_at as changed_at,
             ${rate.mc} as rate
      from (
        select distinct on (${messages.number}, ${messages.variant})
               ${messages.id} as id, ${messages.updatedAt} as updated_at,
               ${messages.number} as number, ${messages.variant} as variant
        from ${messages}
        where ${messageWhere}
        order by ${messages.number}, ${messages.variant},
                 ${messages.updatedAt} desc, ${messages.id} desc
      ) m
    ) u
    ${order}
    limit ${limit} offset ${offset}
  `)) as unknown as Array<{ kind: string; row_id: number; changed_at: string }>;

  const creativeIds = cursor
    .filter((r) => r.kind === "uploaded")
    .map((r) => r.row_id);
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
    const sizes = r.message.template
      ? (templates.get(r.message.template) ?? [])
      : [];
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
