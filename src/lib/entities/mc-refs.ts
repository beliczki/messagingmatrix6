import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";

// MCs that block the hard delete of the audience/topic they reference. Every
// status counts, archived rows included: the rule is that no message may be
// orphaned, not that it is currently live. Shared by the topics and audiences
// delete paths so both refuse on the same set and report the same detail.
export type BlockingMc = {
  id: number;
  number: number;
  variant: string;
  status: string | null;
  name: string | null;
};

// The caller only needs "is it blocked, and by roughly what" — a topic with
// hundreds of MCs is refused on the first page just as firmly.
const MAX_LISTED = 50;

export async function blockingMcs(
  clientId: number,
  dimension: "audience" | "topic",
  key: string,
): Promise<BlockingMc[]> {
  return db
    .select({
      id: messages.id,
      number: messages.number,
      variant: messages.variant,
      status: messages.status,
      name: messages.name,
    })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(dimension === "audience" ? messages.audience : messages.topic, key),
      ),
    )
    .orderBy(messages.number, messages.variant)
    .limit(MAX_LISTED);
}
