import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews, shareGalleries } from "@/db/schema";

// Public preview-PNG index for the share viewer. The viewer is
// unauthenticated, so it cannot hit /api/previews/status; access is gated the
// same way /share/[id]/file/[fileId] gates file bytes — on the message id being
// present in THIS share's snapshot metadata. The PNG bytes themselves come from
// /api/previews/[id], which is already deliberately public.
//
// The rows are read live rather than frozen into the snapshot: previews are a
// regenerable derivative, so a share made before `npm run gen:previews` ran
// still picks up the images afterwards.

type Snapshot = { messages?: Array<{ id?: number }> };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, id))
    .limit(1);
  if (!share || share.archivedAt !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let messageIds: number[] = [];
  if (share.metadata) {
    try {
      const meta = JSON.parse(share.metadata) as Snapshot;
      messageIds = (meta.messages ?? [])
        .map((m) => m?.id)
        .filter((n): n is number => typeof n === "number");
    } catch {
      return NextResponse.json({ error: "snapshot_corrupt" }, { status: 500 });
    }
  }
  if (messageIds.length === 0) return NextResponse.json({ previews: [] });

  // Chunked IN list: a big share is a few hundred MCs and each MC has one row
  // per template size, so the unbounded form would both build a huge IN and
  // return well over a thousand rows.
  const CHUNK = 500;
  const rows: Array<{
    messageId: number;
    size: string;
    previewId: number;
    updatedAt: string;
  }> = [];
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const page = await db
      .select({
        messageId: messagePreviews.messageId,
        size: messagePreviews.size,
        previewId: messagePreviews.id,
        updatedAt: messagePreviews.updatedAt,
      })
      .from(messagePreviews)
      .where(
        and(
          eq(messagePreviews.clientId, share.clientId),
          inArray(messagePreviews.messageId, messageIds.slice(i, i + CHUNK)),
        ),
      );
    rows.push(...page);
  }

  return NextResponse.json(
    { previews: rows },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
