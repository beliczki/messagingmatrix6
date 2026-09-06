import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { parseSlidesFileId } from "@/lib/slides-link";

// The Google Slides deck a piece of work came in on. NOT an entity — a column.
//
// A brief needs an identity because several cards point at one, and that
// identity is the Drive FILE ID: the same deck arrives as `?usp=sharing`, with
// a `/u/0/` prefix and with a `#slide=` fragment, and slides-link.ts reduces
// all three to one string. Once the value is canonical, equality on it IS the
// fact that two cards share a deck — a `briefs` row added a surrogate key for
// a value that already had one, and with it an orphan row every time a link
// was cleared. The only payload such a row could carry is a human label for
// the deck, and nothing ever wrote one; if that is ever wanted, the honest
// source is the Drive API's file title, which needs no table either.

export class BriefError extends Error {}

/** One deck, with what became of the work that came in on it. */
export type BriefDeck = {
  slidesFileId: string;
  /** Cards still waiting for a cell. */
  openDrafts: number;
  /** Cards that started as a draft under this deck and were promoted. */
  promoted: number;
};

// The cheap version of a Close Check: it answers "what came of this brief?"
// without a state machine to keep in sync, because both numbers are counted
// from the work itself. A GROUP BY now, where it used to be a join.
export async function listBriefDecks(clientId: number): Promise<BriefDeck[]> {
  const rows = await db
    .select({
      slidesFileId: messages.briefSlidesFileId,
      status: messages.status,
      n: sql<number>`count(*)::int`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        isNull(messages.archivedAt),
        isNotNull(messages.briefSlidesFileId),
      ),
    )
    .groupBy(messages.briefSlidesFileId, messages.status);

  const byDeck = new Map<string, BriefDeck>();
  for (const r of rows) {
    const fileId = r.slidesFileId!;
    const deck = byDeck.get(fileId) ?? {
      slidesFileId: fileId,
      openDrafts: 0,
      promoted: 0,
    };
    if (r.status === "DRAFT") deck.openDrafts += r.n;
    else deck.promoted += r.n;
    byDeck.set(fileId, deck);
  }
  return [...byDeck.values()].sort((a, b) =>
    a.slidesFileId.localeCompare(b.slidesFileId),
  );
}

/**
 * The file id a pasted link names, or a BriefError explaining what was pasted
 * instead. The one place a link becomes a stored value.
 */
export function briefFileIdFromLink(link: string): string {
  const fileId = parseSlidesFileId(link);
  if (!fileId) {
    throw new BriefError(
      /\/folders\//.test(link)
        ? "that is a Drive FOLDER link — paste the link to the brief document itself"
        : "could not find a Google Slides/Docs file id in that link",
    );
  }
  return fileId;
}
