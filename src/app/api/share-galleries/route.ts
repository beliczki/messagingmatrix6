import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import {
  creatives,
  messages,
  shareComments,
  shareGalleries,
  uploadedFiles,
  users,
} from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { readTemplate } from "@/lib/templates";

type SnapshotMetadata = {
  generatedAt: string;
  messages: Array<typeof messages.$inferSelect>;
  /** (messageId, size) pairs the user picked — drives the public renderer. */
  matrixItems?: Array<{ messageId: number; size: string }>;
  creatives?: Array<typeof creatives.$inferSelect>;
  files?: Array<{
    id: string;
    filename: string;
    mimeType: string | null;
    sizeBytes: number | null;
    dimensions: string | null;
  }>;
};

export const GET = withSession(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const where = includeArchived
    ? eq(shareGalleries.clientId, claims.cid)
    : and(
        eq(shareGalleries.clientId, claims.cid),
        isNull(shareGalleries.archivedAt),
      );
  const rows = db
    .select()
    .from(shareGalleries)
    .where(where)
    .orderBy(desc(shareGalleries.createdAt))
    .all();

  const userIds = [
    ...new Set(rows.map((r) => r.createdBy).filter((s): s is string => !!s)),
  ];
  const emailById = userIds.length
    ? new Map(
        db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
          .all()
          .map((u) => [u.id, u.email]),
      )
    : new Map<string, string>();

  const shareIds = rows.map((r) => r.id);
  const commentCountById = shareIds.length
    ? new Map(
        db
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
          .all()
          .map((c) => [c.id, Number(c.count)]),
      )
    : new Map<string, number>();

  return NextResponse.json({
    shares: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdBy: r.createdBy,
      createdByEmail: r.createdBy ? emailById.get(r.createdBy) ?? null : null,
      createdAt: r.createdAt,
      archivedAt: r.archivedAt,
      messageCount: messageCountFromMetadata(r.metadata),
      commentCount: commentCountById.get(r.id) ?? 0,
      viewCount: r.viewCount,
      downloadCount: r.downloadCount,
    })),
  });
});

function messageCountFromMetadata(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotMetadata>;
    const m = Array.isArray(parsed.matrixItems)
      ? parsed.matrixItems.length
      : Array.isArray(parsed.messages)
        ? parsed.messages.length
        : 0;
    const c = Array.isArray(parsed.creatives) ? parsed.creatives.length : 0;
    return m + c;
  } catch {
    return 0;
  }
}

export const POST = withSession(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | {
        title?: unknown;
        description?: unknown;
        mcIds?: unknown;
        matrix?: unknown;
        creativeIds?: unknown;
      }
    | null;
  const mcIds = Array.isArray(body?.mcIds)
    ? body!.mcIds.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];
  const matrixPairsIn: Array<{ messageId: number; size: string }> =
    Array.isArray(body?.matrix)
      ? (body!.matrix as Array<unknown>)
          .map((p) => {
            if (!p || typeof p !== "object") return null;
            const o = p as Record<string, unknown>;
            const id = Number(o.messageId);
            const size = typeof o.size === "string" ? o.size : null;
            if (!Number.isFinite(id) || !size) return null;
            return { messageId: id, size };
          })
          .filter((x): x is { messageId: number; size: string } => x !== null)
      : [];
  const creativeIds = Array.isArray(body?.creativeIds)
    ? body!.creativeIds.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    : [];
  if (
    mcIds.length === 0 &&
    matrixPairsIn.length === 0 &&
    creativeIds.length === 0
  ) {
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

  // Resolve all referenced message ids — both the size-aware `matrix` pairs
  // and the legacy `mcIds` (which need a default size resolved server-side
  // from the template registry).
  const allMessageIds = Array.from(
    new Set([...mcIds, ...matrixPairsIn.map((p) => p.messageId)]),
  );
  const messageRows = allMessageIds.length
    ? db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.clientId, claims.cid),
            inArray(messages.id, allMessageIds),
          ),
        )
        .all()
    : [];

  // Fan out legacy mcIds → matrix pairs by defaulting each to the message's
  // template defaultSize (or the first available size).
  const messageById = new Map(messageRows.map((m) => [m.id, m]));
  const fannedFromMcIds: Array<{ messageId: number; size: string }> = [];
  for (const id of mcIds) {
    const m = messageById.get(id);
    if (!m || !m.template) continue;
    const tinfo = readTemplate(m.template);
    const size = tinfo?.defaultSize ?? tinfo?.sizes[0] ?? null;
    if (!size) continue;
    fannedFromMcIds.push({ messageId: id, size });
  }
  // Dedupe (messageId, size) pairs across both inputs.
  const matrixSeen = new Set<string>();
  const matrixItems: Array<{ messageId: number; size: string }> = [];
  for (const p of [...matrixPairsIn, ...fannedFromMcIds]) {
    if (!messageById.has(p.messageId)) continue;
    const k = `${p.messageId}|${p.size}`;
    if (matrixSeen.has(k)) continue;
    matrixSeen.add(k);
    matrixItems.push(p);
  }
  const creativeRows = creativeIds.length
    ? db
        .select()
        .from(creatives)
        .where(
          and(
            eq(creatives.clientId, claims.cid),
            inArray(creatives.id, creativeIds),
          ),
        )
        .all()
    : [];
  if (messageRows.length === 0 && creativeRows.length === 0) {
    return NextResponse.json(
      { error: "no matching messages or creatives found in this client" },
      { status: 400 },
    );
  }

  // Snapshot file metadata for any creative that references one — the public
  // share viewer cannot hit the auth-gated /api/files endpoints, so we expose
  // these via a share-scoped proxy that checks the file id is in this list.
  const fileIds = Array.from(
    new Set(creativeRows.map((c) => c.fileId).filter((s): s is string => !!s)),
  );
  const fileRows = fileIds.length
    ? db
        .select({
          id: uploadedFiles.id,
          filename: uploadedFiles.filename,
          mimeType: uploadedFiles.mimeType,
          sizeBytes: uploadedFiles.sizeBytes,
          dimensions: uploadedFiles.dimensions,
        })
        .from(uploadedFiles)
        .where(
          and(
            eq(uploadedFiles.clientId, claims.cid),
            inArray(uploadedFiles.id, fileIds),
          ),
        )
        .all()
    : [];

  const metadata: SnapshotMetadata = {
    generatedAt: new Date().toISOString(),
    messages: messageRows,
    matrixItems,
    creatives: creativeRows,
    files: fileRows,
  };

  const id = nanoid(12);
  const inserted = db
    .insert(shareGalleries)
    .values({
      id,
      clientId: claims.cid,
      title,
      description,
      createdBy: claims.sub,
      metadata: JSON.stringify(metadata),
    })
    .returning()
    .get();

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "share_galleries",
    entityId: id,
    action: "create",
    after: {
      id: inserted.id,
      title: inserted.title,
      matrixCount: matrixItems.length,
      creativeCount: creativeRows.length,
    },
  });

  return NextResponse.json(
    {
      share: {
        id: inserted.id,
        title: inserted.title,
        description: inserted.description,
        createdAt: inserted.createdAt,
        matrixCount: matrixItems.length,
        creativeCount: creativeRows.length,
      },
    },
    { status: 201 },
  );
});
