import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creatives, nowUtc, type Creative } from "@/db/schema";

const WRITABLE_FIELDS = [
  "brand",
  "product",
  "type",
  "visualKeyword",
  "copyKeyword",
  "template",
  "bannerVersion",
  "mcNumber",
  "mcVariant",
  "fileId",
  "fileName",
  "fileFormat",
  "fileSize",
  "fileDimensions",
  "comment",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type CreativeInput = Partial<Pick<Creative, WritableField>>;

export function pickWritable(input: unknown): CreativeInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as CreativeInput;
}

export async function listCreatives(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Creative[]> {
  const where = opts.includeArchived
    ? eq(creatives.clientId, clientId)
    : and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt));
  return db.select().from(creatives).where(where).orderBy(creatives.id);
}

// All live creatives back-linked to one matrix cell (mcNumber + mcVariant).
// Powers the nonDCO static-MC preview's size switcher: same creative name,
// many sizes — each a separate creatives row sharing the (mcNumber, mcVariant).
export async function listCreativesByMc(
  clientId: number,
  mcNumber: number,
  mcVariant: string,
): Promise<Creative[]> {
  return db
    .select()
    .from(creatives)
    .where(
      and(
        eq(creatives.clientId, clientId),
        eq(creatives.mcNumber, mcNumber),
        eq(creatives.mcVariant, mcVariant),
        isNull(creatives.archivedAt),
      ),
    )
    .orderBy(creatives.id);
}

export async function getCreative(
  clientId: number,
  id: number,
): Promise<Creative | null> {
  const rows = await db
    .select()
    .from(creatives)
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createCreative(
  clientId: number,
  input: CreativeInput,
): Promise<Creative> {
  const [row] = await db
    .insert(creatives)
    .values({ ...input, clientId })
    .returning();
  return row;
}

export async function updateCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: CreativeInput,
): Promise<
  { ok: true; row: Creative } | { ok: false; current: Creative | null }
> {
  const current = await getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(creatives)
    .set({
      ...input,
      version: sql`${creatives.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning();
  return { ok: true, row: updated };
}

export async function archiveCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  { ok: true; row: Creative } | { ok: false; current: Creative | null }
> {
  const current = await getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(creatives)
    .set({
      archivedAt: nowUtc,
      version: sql`${creatives.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning();
  return { ok: true, row: updated };
}

export async function restoreCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  { ok: true; row: Creative } | { ok: false; current: Creative | null }
> {
  const current = await getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(creatives)
    .set({
      archivedAt: null,
      version: sql`${creatives.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning();
  return { ok: true, row: updated };
}
