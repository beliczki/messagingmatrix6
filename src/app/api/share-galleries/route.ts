import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { shareComments, shareGalleries, users } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { shareItemCount } from "@/lib/share-metadata";
import { writeAudit } from "@/lib/audit";
import {
  isEmptySelection,
  parseShareSelection,
  resolveShareSelection,
  shareThumbs,
  warmShareStills,
  type SnapshotMetadata,
} from "@/lib/share-snapshot";

export const GET = withSession(async ({ req, claims }) => {
  const params = new URL(req.url).searchParams;
  const includeArchived = params.get("includeArchived") === "1";
  // Only the add-to-share picker shows thumbnails; the Shares table does not
  // pay for the preview lookup.
  const withThumbs = params.get("thumbs") === "1";
  const where = includeArchived
    ? eq(shareGalleries.clientId, claims.cid)
    : and(
        eq(shareGalleries.clientId, claims.cid),
        isNull(shareGalleries.archivedAt),
      );
  const rows = await db
    .select()
    .from(shareGalleries)
    .where(where)
    .orderBy(desc(shareGalleries.createdAt));

  const userIds = [
    ...new Set(rows.map((r) => r.createdBy).filter((s): s is string => !!s)),
  ];
  const emailById = userIds.length
    ? new Map(
        (
          await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds))
        ).map((u) => [u.id, u.email]),
      )
    : new Map<string, string>();

  const shareIds = rows.map((r) => r.id);
  const commentCountById = shareIds.length
    ? new Map(
        (
          await db
            .select({
              id: shareComments.shareGalleryId,
              count: sql<number>`count(*)`.as("count"),
            })
            .from(shareComments)
            .where(
              and(
                inArray(shareComments.shareGalleryId, shareIds),
                isNull(shareComments.archivedAt),
              ),
            )
            .groupBy(shareComments.shareGalleryId)
        ).map((c) => [c.id, Number(c.count)]),
      )
    : new Map<string, number>();

  const thumbsById = withThumbs ? await shareThumbs(claims.cid, rows) : null;

  return NextResponse.json({
    shares: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdBy: r.createdBy,
      createdByEmail: r.createdBy ? emailById.get(r.createdBy) ?? null : null,
      createdAt: r.createdAt,
      archivedAt: r.archivedAt,
      messageCount: shareItemCount(r.metadata),
      commentCount: commentCountById.get(r.id) ?? 0,
      viewCount: r.viewCount,
      downloadCount: r.downloadCount,
      ...(thumbsById ? { thumbs: thumbsById.get(r.id) } : {}),
    })),
  });
});

export const POST = withSession(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; description?: unknown }
    | null;
  const selection = parseShareSelection(body);
  if (isEmptySelection(selection)) {
    return NextResponse.json(
      {
        error:
          "matrix, mcIds, or creativeIds (at least one non-empty) required",
      },
      { status: 400 },
    );
  }

  const title =
    typeof body?.title === "string" && body.title.trim().length > 0
      ? body.title.trim()
      : null;
  const description =
    typeof body?.description === "string" ? body.description.trim() : null;

  const resolved = await resolveShareSelection(claims.cid, selection);
  if (resolved.messages.length === 0 && resolved.creatives.length === 0) {
    return NextResponse.json(
      { error: "no matching messages or creatives found in this client" },
      { status: 400 },
    );
  }

  const metadata: SnapshotMetadata = {
    generatedAt: new Date().toISOString(),
    ...resolved,
  };

  const id = nanoid(12);
  const [inserted] = await db
    .insert(shareGalleries)
    .values({
      id,
      clientId: claims.cid,
      title,
      description,
      createdBy: claims.sub,
      metadata: JSON.stringify(metadata),
    })
    .returning();

  await warmShareStills(
    claims.cid,
    id,
    resolved.files.map((f) => f.id),
  );

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "share_galleries",
    entityId: id,
    action: "create",
    after: {
      id: inserted.id,
      title: inserted.title,
      matrixCount: resolved.matrixItems.length,
      creativeCount: resolved.creatives.length,
    },
  });

  return NextResponse.json(
    {
      share: {
        id: inserted.id,
        title: inserted.title,
        description: inserted.description,
        createdAt: inserted.createdAt,
        matrixCount: resolved.matrixItems.length,
        creativeCount: resolved.creatives.length,
      },
    },
    { status: 201 },
  );
});
