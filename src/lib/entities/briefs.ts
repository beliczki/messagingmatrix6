import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { briefs, messages, nowUtc, type Brief } from "@/db/schema";
import { parseSlidesFileId } from "@/lib/slides-link";

// The Google Slides deck a piece of work came in on. Deliberately NOT a
// work-item entity: no state, owner, due date or revision seal — those belong
// to the Grafia OS closure contract, which this layer does not implement. What
// a brief needs is an IDENTITY, because several drafts point at one, and that
// identity is the Drive file id rather than the URL (see slides-link.ts).
//
// Attaching is an upsert, not an insert: pasting the same deck twice — or
// pasting the editor link where someone else pasted the Drive link — has to
// land on the one row, or the drafts that share a brief stop being grouped.

export class BriefError extends Error {}

export type BriefWithProgress = Brief & {
  /** Drafts still waiting to be placed in the matrix. */
  openDrafts: number;
  /** Cards that started life as a draft under this brief and were promoted. */
  promoted: number;
};

export async function listBriefs(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Brief[]> {
  const conds = [eq(briefs.clientId, clientId)];
  if (!opts.includeArchived) conds.push(isNull(briefs.archivedAt));
  return db
    .select()
    .from(briefs)
    .where(and(...conds))
    .orderBy(desc(briefs.createdAt), asc(briefs.id));
}

// Briefs with their promote progress — the cheap version of a Close Check: it
// answers "what came of this brief?" without a state machine to keep in sync,
// because both numbers are counted from the work itself.
export async function listBriefsWithProgress(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<BriefWithProgress[]> {
  const rows = await listBriefs(clientId, opts);
  if (rows.length === 0) return [];
  const counts = await db
    .select({
      briefId: messages.briefId,
      status: messages.status,
      n: sql<number>`count(*)::int`,
    })
    .from(messages)
    .where(and(eq(messages.clientId, clientId), isNull(messages.archivedAt)))
    .groupBy(messages.briefId, messages.status);

  const open = new Map<number, number>();
  const promoted = new Map<number, number>();
  for (const c of counts) {
    if (c.briefId === null) continue;
    const target = c.status === "DRAFT" ? open : promoted;
    target.set(c.briefId, (target.get(c.briefId) ?? 0) + c.n);
  }
  return rows.map((b) => ({
    ...b,
    openDrafts: open.get(b.id) ?? 0,
    promoted: promoted.get(b.id) ?? 0,
  }));
}

export async function getBrief(
  clientId: number,
  id: number,
): Promise<Brief | null> {
  const [row] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.clientId, clientId), eq(briefs.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a pasted link to a brief, creating the row the first time that deck
 * is seen. Idempotent by file id, which is what makes "same deck, different
 * link" one brief instead of two.
 */
export async function attachBriefByLink(
  clientId: number,
  link: string,
  label?: string | null,
): Promise<Brief> {
  const fileId = parseSlidesFileId(link);
  if (!fileId) {
    throw new BriefError(
      /\/folders\//.test(link)
        ? "that is a Drive FOLDER link — paste the link to the brief document itself"
        : "could not find a Google Slides/Docs file id in that link",
    );
  }
  const [existing] = await db
    .select()
    .from(briefs)
    .where(and(eq(briefs.clientId, clientId), eq(briefs.slidesFileId, fileId)))
    .limit(1);
  if (existing) {
    // Re-attaching an archived brief brings it back — the deck is evidently in
    // use again, and a second row for the same file id is not possible anyway.
    const needsLabel = label != null && label !== existing.label;
    if (!needsLabel && existing.archivedAt === null) return existing;
    const [updated] = await db
      .update(briefs)
      .set({
        ...(needsLabel ? { label } : {}),
        archivedAt: null,
        updatedAt: nowUtc,
      })
      .where(and(eq(briefs.clientId, clientId), eq(briefs.id, existing.id)))
      .returning();
    return updated!;
  }
  const [row] = await db
    .insert(briefs)
    .values({ clientId, slidesFileId: fileId, label: label ?? null })
    .returning();
  return row!;
}

export async function updateBrief(
  clientId: number,
  id: number,
  input: { label?: string | null },
): Promise<Brief | null> {
  const [row] = await db
    .update(briefs)
    .set({ label: input.label ?? null, updatedAt: nowUtc })
    .where(and(eq(briefs.clientId, clientId), eq(briefs.id, id)))
    .returning();
  return row ?? null;
}

// Archive, never hard-delete: the messages.brief_id FK is ON DELETE SET NULL,
// so a real delete would silently cut every draft loose from the reason it
// exists. Archiving keeps the trail and is reversible.
export async function archiveBrief(
  clientId: number,
  id: number,
): Promise<Brief | null> {
  const [row] = await db
    .update(briefs)
    .set({ archivedAt: nowUtc, updatedAt: nowUtc })
    .where(and(eq(briefs.clientId, clientId), eq(briefs.id, id)))
    .returning();
  return row ?? null;
}

export async function restoreBrief(
  clientId: number,
  id: number,
): Promise<Brief | null> {
  const [row] = await db
    .update(briefs)
    .set({ archivedAt: null, updatedAt: nowUtc })
    .where(and(eq(briefs.clientId, clientId), eq(briefs.id, id)))
    .returning();
  return row ?? null;
}
