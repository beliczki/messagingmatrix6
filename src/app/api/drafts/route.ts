import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews } from "@/db/schema";
import {
  createDraft,
  listDrafts,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";
import { listBriefsWithProgress } from "@/lib/entities/briefs";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// The drafts surface. A draft is a `messages` row with no audience, so its
// previews are ordinary message_previews — there is no separate preview table
// and no separate staleness rule to keep in step. Briefs come bundled because
// the page groups by them.
export const GET = withSession(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const drafts = await listDrafts(claims.cid, { includeArchived });
  const ids = drafts.map((d) => d.id);
  const previews = ids.length
    ? await db
        .select({
          id: messagePreviews.id,
          messageId: messagePreviews.messageId,
          size: messagePreviews.size,
          messageVersion: messagePreviews.messageVersion,
          updatedAt: messagePreviews.updatedAt,
        })
        .from(messagePreviews)
        .where(
          and(
            eq(messagePreviews.clientId, claims.cid),
            inArray(messagePreviews.messageId, ids),
          ),
        )
    : [];
  return NextResponse.json({
    drafts,
    previews,
    briefs: await listBriefsWithProgress(claims.cid),
  });
});

// Take work on: claims an MC number now, cell decided later.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = await req.json().catch(() => null);
  const input = pickWritable(body ?? {});
  try {
    const row = await createDraft(claims.cid, input);
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: row.id,
      action: "create",
      after: row,
    });
    return NextResponse.json({ draft: row }, { status: 201 });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
