import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { shareGalleries } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

export const DELETE = withSession<{ id: string }>(({ claims, params }) => {
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
  db.delete(shareGalleries)
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
    action: "delete",
    before: { id: existing.id, title: existing.title },
  });
  return NextResponse.json({ ok: true });
});
