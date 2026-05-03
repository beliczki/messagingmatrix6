import { NextResponse } from "next/server";
import { and, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { isLive, getLastSeen } from "@/lib/presence";

const ALLOWED_ROLES = ["admin", "user"] as const;
type Role = (typeof ALLOWED_ROLES)[number];

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

function latestActionByUser(clientId: number): Map<string, string> {
  // SQLite "bare columns with MAX": grouping by user_id with MAX(created_at)
  // returns the action of the row that holds the max timestamp (since 3.7.11).
  const rows = db
    .select({
      userId: auditLog.userId,
      action: auditLog.action,
      createdAt: sql<string>`MAX(${auditLog.createdAt})`.as("last_created"),
    })
    .from(auditLog)
    .where(and(eq(auditLog.clientId, clientId), isNotNull(auditLog.userId)))
    .groupBy(auditLog.userId)
    .all();
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.userId === null) continue;
    out.set(r.userId, r.action);
  }
  return out;
}

function fallbackLastActiveByUser(clientId: number): Map<string, string> {
  // For users who aren't currently live, surface the audit-log timestamp so
  // "last seen 2 hours ago" still works.
  const rows = db
    .select({
      userId: auditLog.userId,
      createdAt: sql<string>`MAX(${auditLog.createdAt})`.as("last_created"),
    })
    .from(auditLog)
    .where(and(eq(auditLog.clientId, clientId), isNotNull(auditLog.userId)))
    .groupBy(auditLog.userId)
    .all();
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.userId === null) continue;
    out.set(r.userId, r.createdAt);
  }
  return out;
}

export const GET = withAdmin(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const where = includeArchived
    ? eq(users.clientId, claims.cid)
    : and(eq(users.clientId, claims.cid), isNull(users.archivedAt));
  const rows = db.select().from(users).where(where).all();
  const lastAction = latestActionByUser(claims.cid);
  const auditLastActive = fallbackLastActiveByUser(claims.cid);
  return NextResponse.json({
    users: rows.map((u) => {
      const live = isLive(u.id);
      const presenceLastSeenMs = getLastSeen(u.id);
      const lastActive = live
        ? new Date(presenceLastSeenMs ?? Date.now()).toISOString()
        : presenceLastSeenMs !== null
          ? new Date(presenceLastSeenMs).toISOString()
          : auditLastActive.get(u.id) ?? null;
      return {
        ...pickUser(u),
        live,
        lastActive,
        lastAction: lastAction.get(u.id) ?? null,
      };
    }),
  });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; password?: unknown; role?: unknown }
    | null;
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { error: "email and password required" },
      { status: 400 },
    );
  }
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const role: Role =
    body.role === "admin" || body.role === "user" ? body.role : "user";

  if (email.length === 0 || !email.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const existing = db
    .select()
    .from(users)
    .where(and(eq(users.clientId, claims.cid), eq(users.email, email)))
    .get();
  if (existing) {
    return NextResponse.json(
      { error: `user with email "${email}" already exists for this client` },
      { status: 409 },
    );
  }

  const hashed = await hashPassword(password);
  const inserted = db
    .insert(users)
    .values({
      id: nanoid(),
      clientId: claims.cid,
      email,
      password: hashed,
      role,
    })
    .returning()
    .get();

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "users",
    entityId: inserted.id,
    action: "create",
    after: pickUser(inserted),
  });

  return NextResponse.json({ user: pickUser(inserted) }, { status: 201 });
});
