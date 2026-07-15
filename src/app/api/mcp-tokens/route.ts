import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens, users, type McpToken } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { generateToken, maskToken } from "./token";

// Per-user MCP bearer tokens (Settings → MCP). Raw tokens are returned only
// by POST (creation) and the reveal action — list responses are masked.

function pickToken(t: McpToken, userEmail: string) {
  return {
    id: t.id,
    userId: t.userId,
    userEmail,
    scope: t.scope,
    label: t.label,
    tokenMasked: maskToken(t.token),
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
    archivedAt: t.archivedAt,
  };
}

export const GET = withAdmin(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const where = includeArchived
    ? eq(mcpTokens.clientId, claims.cid)
    : and(eq(mcpTokens.clientId, claims.cid), isNull(mcpTokens.archivedAt));
  const rows = await db
    .select({ tok: mcpTokens, email: users.email })
    .from(mcpTokens)
    .innerJoin(users, eq(users.id, mcpTokens.userId))
    .where(where)
    .orderBy(mcpTokens.id);
  return NextResponse.json({
    tokens: rows.map((r) => pickToken(r.tok, r.email)),
  });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { userId?: unknown; scope?: unknown; label?: unknown }
    | null;
  if (!body || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (body.scope !== "full" && body.scope !== "read") {
    return NextResponse.json(
      { error: 'scope must be "full" or "read"' },
      { status: 400 },
    );
  }
  const label =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim()
      : null;

  const [owner] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, body.userId), eq(users.clientId, claims.cid)))
    .limit(1);
  if (!owner || owner.archivedAt) {
    return NextResponse.json(
      { error: "user not found in this client (or archived)" },
      { status: 400 },
    );
  }
  if (owner.role === "demo" && body.scope !== "read") {
    return NextResponse.json(
      { error: "demo users can only hold read tokens" },
      { status: 400 },
    );
  }

  const token = generateToken();
  const [inserted] = await db
    .insert(mcpTokens)
    .values({
      clientId: claims.cid,
      userId: owner.id,
      token,
      scope: body.scope,
      label,
    })
    .returning();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "mcp_tokens",
    entityId: inserted.id,
    action: "create",
    after: pickToken(inserted, owner.email),
  });

  // Raw token returned once here; the UI shows it in the reveal modal.
  return NextResponse.json(
    { token, ...pickToken(inserted, owner.email) },
    { status: 201 },
  );
});
