import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedExports, nowUtc } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const POST = withSession<Params>(async ({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const [row] = await db
    .select()
    .from(feedExports)
    .where(and(eq(feedExports.clientId, claims.cid), eq(feedExports.id, id)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (row.uploadedToAdformAt) {
    return NextResponse.json(
      { error: "already_uploaded", uploadedToAdformAt: row.uploadedToAdformAt },
      { status: 409 },
    );
  }

  await db
    .update(feedExports)
    .set({
      uploadedToAdformAt: nowUtc,
      uploadedBy: claims.sub,
    })
    .where(and(eq(feedExports.clientId, claims.cid), eq(feedExports.id, id)));

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "feed_exports",
    entityId: id,
    action: "update",
    before: {
      uploadedToAdformAt: null,
    },
    after: {
      uploadedToAdformAt: "now",
      uploadedBy: claims.sub,
    },
  });

  const [updated] = await db
    .select()
    .from(feedExports)
    .where(and(eq(feedExports.clientId, claims.cid), eq(feedExports.id, id)))
    .limit(1);

  return NextResponse.json({
    feedExport: {
      id: updated!.id,
      uploadedToAdformAt: updated!.uploadedToAdformAt,
      uploadedBy: updated!.uploadedBy,
    },
  });
});
