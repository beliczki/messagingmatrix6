import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { shareGalleries, nowUtc } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const DELETE = withSession<{ id: string }>(async ({ claims, params }) => {
  const id = params.id;
  const [existing] = await db
    .select()
    .from(shareGalleries)
    .where(
      and(eq(shareGalleries.clientId, claims.cid), eq(shareGalleries.id, id)),
    )
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "share not found" }, { status: 404 });
  }
  await db
    .update(shareGalleries)
    .set({
      archivedAt: nowUtc,
      updatedAt: nowUtc,
    })
    .where(
      and(eq(shareGalleries.clientId, claims.cid), eq(shareGalleries.id, id)),
    );
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "share_galleries",
    entityId: id,
    action: "archive",
    before: { id: existing.id, title: existing.title },
    after: { id: existing.id, title: existing.title, archived: true },
  });
  return NextResponse.json({ ok: true });
});
