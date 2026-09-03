import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { creatives, nowUtc, type Creative } from "@/db/schema";
import { parseDriveFolderId } from "@/lib/drive-link";

export class CreativeError extends Error {}

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

// driveFolderId is writable but never taken raw: it is derived from the link
// the user pastes (driveFolderUrl), so a malformed link is a 400 instead of a
// stored string nothing can resolve. driveFileId/driveFolderName/driveCheckedAt
// are machine-owned — only the resolver writes them.
export type CreativeInput = Partial<Pick<Creative, WritableField>> & {
  driveFolderId?: string | null;
};

export function pickWritable(input: unknown): CreativeInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  if ("driveFolderUrl" in src) {
    const raw = typeof src.driveFolderUrl === "string" ? src.driveFolderUrl.trim() : "";
    if (raw === "") {
      out.driveFolderId = null;
    } else {
      const id = parseDriveFolderId(raw);
      if (!id) throw new CreativeError("not a Google Drive folder link");
      out.driveFolderId = id;
    }
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
  // A different (or cleared) folder invalidates everything the resolver
  // derived from the old one — the stored file link would otherwise keep
  // pointing into a folder this creative no longer claims to live in.
  const folderMoved =
    input.driveFolderId !== undefined &&
    input.driveFolderId !== current.driveFolderId;
  const [updated] = await db
    .update(creatives)
    .set({
      ...input,
      ...(folderMoved
        ? { driveFileId: null, driveFolderName: null, driveCheckedAt: null }
        : {}),
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
