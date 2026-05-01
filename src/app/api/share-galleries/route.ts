import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { messages, shareGalleries } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type SnapshotMetadata = {
  generatedAt: string;
  messages: Array<typeof messages.$inferSelect>;
};

export const GET = withSession(({ claims }) => {
  const rows = db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.clientId, claims.cid))
    .orderBy(desc(shareGalleries.createdAt))
    .all();
  return NextResponse.json({
    shares: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      messageCount: messageCountFromMetadata(r.metadata),
    })),
  });
});

function messageCountFromMetadata(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as Partial<SnapshotMetadata>;
    return Array.isArray(parsed.messages) ? parsed.messages.length : 0;
  } catch {
    return 0;
  }
}

export const POST = withSession(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { title?: unknown; description?: unknown; mcIds?: unknown }
    | null;
  if (!body || !Array.isArray(body.mcIds) || body.mcIds.length === 0) {
    return NextResponse.json(
      { error: "mcIds (non-empty array) required" },
      { status: 400 },
    );
  }
  const ids = body.mcIds
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "mcIds must be numeric ids" },
      { status: 400 },
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim()
      : null;
  const description =
    typeof body.description === "string" ? body.description.trim() : null;

  const rows = db
    .select()
    .from(messages)
    .where(and(eq(messages.clientId, claims.cid), inArray(messages.id, ids)))
    .all();

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "no matching messages found in this client" },
      { status: 400 },
    );
  }

  const metadata: SnapshotMetadata = {
    generatedAt: new Date().toISOString(),
    messages: rows,
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
      messageCount: rows.length,
    },
  });

  return NextResponse.json(
    {
      share: {
        id: inserted.id,
        title: inserted.title,
        description: inserted.description,
        createdAt: inserted.createdAt,
        messageCount: rows.length,
      },
    },
    { status: 201 },
  );
});
