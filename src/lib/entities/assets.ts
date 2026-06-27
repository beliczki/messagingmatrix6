import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, nowUtc, type Asset } from "@/db/schema";

const WRITABLE_FIELDS = [
  "brand",
  "product",
  "type",
  "visualKeyword",
  "fileId",
  "fileName",
  "fileFormat",
  "fileSize",
  "fileDimensions",
  "comment",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type AssetInput = Partial<Pick<Asset, WritableField>>;

export function pickWritable(input: unknown): AssetInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as AssetInput;
}

export async function listAssets(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Asset[]> {
  const where = opts.includeArchived
    ? eq(assets.clientId, clientId)
    : and(eq(assets.clientId, clientId), isNull(assets.archivedAt));
  return db.select().from(assets).where(where).orderBy(assets.id);
}

export async function getAsset(
  clientId: number,
  id: number,
): Promise<Asset | null> {
  const rows = await db
    .select()
    .from(assets)
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAsset(
  clientId: number,
  input: AssetInput,
): Promise<Asset> {
  const [row] = await db
    .insert(assets)
    .values({ ...input, clientId })
    .returning();
  return row;
}

export async function updateAsset(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: AssetInput,
): Promise<{ ok: true; row: Asset } | { ok: false; current: Asset | null }> {
  const current = await getAsset(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(assets)
    .set({
      ...input,
      version: sql`${assets.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .returning();
  return { ok: true, row: updated };
}

export async function archiveAsset(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<{ ok: true; row: Asset } | { ok: false; current: Asset | null }> {
  const current = await getAsset(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(assets)
    .set({
      archivedAt: nowUtc,
      version: sql`${assets.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .returning();
  return { ok: true, row: updated };
}

export async function restoreAsset(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<{ ok: true; row: Asset } | { ok: false; current: Asset | null }> {
  const current = await getAsset(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(assets)
    .set({
      archivedAt: null,
      version: sql`${assets.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .returning();
  return { ok: true, row: updated };
}
