import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creatives, type Creative } from "@/db/schema";

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

export function listCreatives(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Creative[] {
  const where = opts.includeArchived
    ? eq(creatives.clientId, clientId)
    : and(eq(creatives.clientId, clientId), isNull(creatives.archivedAt));
  return db
    .select()
    .from(creatives)
    .where(where)
    .orderBy(creatives.id)
    .all();
}

export function getCreative(clientId: number, id: number): Creative | null {
  return (
    db
      .select()
      .from(creatives)
      .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
      .get() ?? null
  );
}

export function createCreative(
  clientId: number,
  input: CreativeInput,
): Creative {
  return db
    .insert(creatives)
    .values({ ...input, clientId })
    .returning()
    .get();
}

export function updateCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: CreativeInput,
): { ok: true; row: Creative } | { ok: false; current: Creative | null } {
  const current = getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(creatives)
    .set({
      ...input,
      version: sql`${creatives.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

export function archiveCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Creative } | { ok: false; current: Creative | null } {
  const current = getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(creatives)
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      version: sql`${creatives.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

export function restoreCreative(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Creative } | { ok: false; current: Creative | null } {
  const current = getCreative(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const updated = db
    .update(creatives)
    .set({
      archivedAt: null,
      version: sql`${creatives.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(creatives.clientId, clientId), eq(creatives.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}
