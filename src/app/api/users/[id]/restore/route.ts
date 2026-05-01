import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

function pickUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    archivedAt: u.archivedAt,
  };
}

export const POST = withAdmin<{ id: string }>(({ claims, params }) => {
  const id = params.id;
  const existing = db
    .select()
    .from(users)
    .where(and(eq(users.clientId, claims.cid), eq(users.id, id)))
    .get();
  if (!existing) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const updated = db
    .update(users)
    .set({ archivedAt: null, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(users.clientId, claims.cid), eq(users.id, id)))
    .returning()
    .get();

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "users",
    entityId: id,
    action: "restore",
    before: pickUser(existing),
    after: pickUser(updated),
  });

  return NextResponse.json({ user: pickUser(updated) });
});
