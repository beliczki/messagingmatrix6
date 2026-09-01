import { and, count, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { creatives, uploadedFiles } from "@/db/schema";
import type { DayScope } from "@/lib/day-scope";

export type StripItem = {
  id: number;
  fileId: string | null;
  fileName: string | null;
  mimeType: string | null;
  dimensions: string | null;
  mcLabel: string | null;
  createdAt: string;
};

export type StripPage = {
  items: StripItem[];
  /** Rows the window (or, in fallback, the whole library) holds. */
  total: number;
  /** True when the window was empty and this is the latest-arrivals list. */
  fallback: boolean;
  /** Offset for the next page, or null when the list is exhausted. */
  nextOffset: number | null;
};

export const STRIP_PAGE = 24;

/**
 * One page of the dashboard creative strip.
 *
 * Ordered by `createdAt`, never by id: the highest ids in this library are a
 * batch whose createdAt is 2025-12-22, so id order puts old creatives at the
 * front of a strip that claims to show new ones. `createdAt desc` is also what
 * the Creative Library lists by default, so "newest" means the same thing on
 * both pages.
 *
 * Delivery is bursty and most windows hold nothing, so an empty window falls
 * back to the latest arrivals — the caller labels the strip accordingly.
 */
export async function listStripCreatives(
  clientId: number,
  scope: DayScope,
  offset = 0,
  limit = STRIP_PAGE,
): Promise<StripPage> {
  const live = and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt));
  const inScope = and(
    live,
    gte(creatives.createdAt, scope.from),
    lte(creatives.createdAt, scope.to),
  );
  const [scoped] = await db.select({ n: count() }).from(creatives).where(inScope);
  const inWindow = scoped?.n ?? 0;
  const fallback = inWindow === 0;

  let total = inWindow;
  if (fallback) {
    const [all] = await db.select({ n: count() }).from(creatives).where(live);
    total = all?.n ?? 0;
  }

  const rows = await db
    .select({
      id: creatives.id,
      fileId: creatives.fileId,
      fileName: creatives.fileName,
      dimensions: creatives.fileDimensions,
      mcNumber: creatives.mcNumber,
      mcVariant: creatives.mcVariant,
      createdAt: creatives.createdAt,
      mimeType: uploadedFiles.mimeType,
    })
    .from(creatives)
    .leftJoin(uploadedFiles, eq(creatives.fileId, uploadedFiles.id))
    .where(fallback ? live : inScope)
    .orderBy(desc(creatives.createdAt), desc(creatives.id))
    .limit(limit)
    .offset(offset);

  const items: StripItem[] = rows.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    dimensions: r.dimensions,
    mcLabel: r.mcNumber !== null ? `MC${r.mcNumber}${r.mcVariant ?? ""}` : null,
    createdAt: r.createdAt,
  }));

  const consumed = offset + items.length;
  return {
    items,
    total,
    fallback,
    nextOffset: items.length === limit && consumed < total ? consumed : null,
  };
}
