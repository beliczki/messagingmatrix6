import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { users } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";

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

export const GET = withAdmin(({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const where = includeArchived
    ? eq(users.clientId, claims.cid)
    : and(eq(users.clientId, claims.cid), isNull(users.archivedAt));
  const rows = db.select().from(users).where(where).all();
  return NextResponse.json({ users: rows.map(pickUser) });
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
