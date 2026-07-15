import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpTokens } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { maskToken } from "../../token";

// Tokens are re-revealable by design (plaintext storage, matches the old
// clients.mcp_token model). POST because every reveal is audit-logged.
export const POST = withAdmin<{ id: string }>(async ({ claims, params }) => {
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

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "mcp_tokens",
    entityId: id,
    action: "reveal",
    after: { token: maskToken(existing.token) },
  });

  return NextResponse.json({ token: existing.token });
});
