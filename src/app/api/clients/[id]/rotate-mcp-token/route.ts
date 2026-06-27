import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, nowUtc } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

// Spec §17.2 / §5.3 / D8 — rotate MCP bearer for a client. Returns the raw
// token ONCE; subsequent reads only see the masked form.
export const POST = withAdmin<{ id: string }>(async ({ claims, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  const newToken = "mcp_" + crypto.randomBytes(32).toString("hex");
  const [updated] = await db
    .update(clients)
    .set({ mcpToken: newToken, updatedAt: nowUtc })
    .where(eq(clients.id, id))
    .returning();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "clients",
    entityId: id,
    action: "update",
    before: { ...existing, mcpToken: maskToken(existing.mcpToken) },
    after: { ...updated, mcpToken: maskToken(updated.mcpToken) },
  });

  return NextResponse.json({
    token: newToken,
    tokenMasked: maskToken(newToken),
  });
});
