import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens, nowUtc } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { maskToken } from "../token";

// Revoke = soft-archive; the token 401s on its next request.
export const DELETE = withAdmin<{ id: string }>(async ({ claims, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(mcpTokens)
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.clientId, claims.cid)))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "token not found" }, { status: 404 });
  }
  if (existing.archivedAt) {
    return NextResponse.json({ ok: true, archivedAt: existing.archivedAt });
  }

  const [updated] = await db
    .update(mcpTokens)
    .set({ archivedAt: nowUtc, updatedAt: nowUtc })
    .where(eq(mcpTokens.id, id))
    .returning();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "mcp_tokens",
    entityId: id,
    action: "archive",
    before: { ...existing, token: maskToken(existing.token) },
    after: { ...updated, token: maskToken(updated.token) },
  });

  return NextResponse.json({ ok: true, archivedAt: updated.archivedAt });
});
