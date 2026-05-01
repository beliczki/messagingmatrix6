import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { shareGalleries } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const POST = withSession<{ id: string }>(({ claims, params }) => {
  const id = params.id;
  const existing = db
    .select()
    .from(shareGalleries)
    .where(
      and(
        eq(shareGalleries.clientId, claims.cid),
        eq(shareGalleries.id, id),
      ),
    )
    .get();
  if (!existing) {
    return NextResponse.json({ error: "share not found" }, { status: 404 });
  }
  db.update(shareGalleries)
    .set({ archivedAt: null, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(shareGalleries.clientId, claims.cid),
        eq(shareGalleries.id, id),
      ),
    )
    .run();
  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "share_galleries",
    entityId: id,
    action: "restore",
    before: { id: existing.id, title: existing.title, archived: true },
    after: { id: existing.id, title: existing.title, archived: false },
  });
  return NextResponse.json({ ok: true });
});
