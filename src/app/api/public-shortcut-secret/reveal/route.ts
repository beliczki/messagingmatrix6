import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { ensureSecret, maskSecret } from "@/lib/public-shortcut";

// POST, not GET, because every reveal is audit-logged — same rule as
// /api/mcp-tokens/[id]/reveal. The log records the MASK, never the value.
export const POST = withAdmin(async ({ claims }) => {
  const secret = await ensureSecret();
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "system_config",
    entityId: "public_shortcut_secret",
    action: "reveal",
    after: { secret: maskSecret(secret) },
  });
  return NextResponse.json({ secret });
});
