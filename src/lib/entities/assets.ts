import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, type Asset } from "@/db/schema";

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

export function listAssets(clientId: number): Asset[] {
  return db
    .select()
    .from(assets)
    .where(eq(assets.clientId, clientId))
    .orderBy(assets.id)
    .all();
}

export function getAsset(clientId: number, id: number): Asset | null {
  return (
    db
      .select()
      .from(assets)
      .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
      .get() ?? null
  );
}

export function createAsset(clientId: number, input: AssetInput): Asset {
  return db.insert(assets).values({ ...input, clientId }).returning().get();
}

export function updateAsset(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: AssetInput,
): { ok: true; row: Asset } | { ok: false; current: Asset | null } {
  const current = getAsset(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(assets)
    .set({
      ...input,
      version: sql`${assets.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

export function deleteAsset(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Asset } | { ok: false; current: Asset | null } {
  const current = getAsset(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  db.delete(assets)
    .where(and(eq(assets.clientId, clientId), eq(assets.id, id)))
    .run();
  return { ok: true, row: current };
}
