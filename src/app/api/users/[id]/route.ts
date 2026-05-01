import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";

const ALLOWED_ROLES = ["admin", "user"] as const;

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

export const PATCH = withAdmin<{ id: string }>(
  async ({ req, claims, params }) => {
    const id = params.id;
    const existing = db
      .select()
      .from(users)
      .where(and(eq(users.clientId, claims.cid), eq(users.id, id)))
      .get();
    if (!existing) {
      return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as
      | { role?: unknown; password?: unknown }
      | null;
    if (!body) {
      return NextResponse.json({ error: "body required" }, { status: 400 });
    }

    const patch: Partial<{ role: string; password: string }> = {};
    if (typeof body.role === "string") {
      if (
        !ALLOWED_ROLES.includes(body.role as (typeof ALLOWED_ROLES)[number])
      ) {
        return NextResponse.json(
          { error: `role must be one of: ${ALLOWED_ROLES.join(", ")}` },
          { status: 400 },
        );
      }
      if (
        existing.id === claims.sub &&
        existing.role === "admin" &&
        body.role !== "admin"
      ) {
        return NextResponse.json(
          { error: "you cannot demote your own admin role" },
          { status: 400 },
        );
      }
      patch.role = body.role;
    }
    if (typeof body.password === "string") {
      if (body.password.length < 8) {
        return NextResponse.json(
          { error: "password must be at least 8 characters" },
          { status: 400 },
        );
      }
      patch.password = await hashPassword(body.password);
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { error: "nothing to update — provide role and/or password" },
        { status: 400 },
      );
    }

    const updated = db
      .update(users)
      .set({ ...patch, updatedAt: sql`(CURRENT_TIMESTAMP)` })
      .where(and(eq(users.clientId, claims.cid), eq(users.id, id)))
      .returning()
      .get();

    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "users",
      entityId: id,
      action: "update",
      before: pickUser(existing),
      after: pickUser(updated),
    });

    return NextResponse.json({ user: pickUser(updated) });
  },
);

export const DELETE = withAdmin<{ id: string }>(({ claims, params }) => {
  const id = params.id;
  if (id === claims.sub) {
    return NextResponse.json(
      { error: "you cannot archive your own user" },
      { status: 400 },
    );
  }
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
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(users.clientId, claims.cid), eq(users.id, id)))
    .returning()
    .get();

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "users",
    entityId: id,
    action: "archive",
    before: pickUser(existing),
    after: pickUser(updated),
  });

  return NextResponse.json({ user: pickUser(updated) });
});
