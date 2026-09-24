import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/scoped";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { SECRET_KEY, maskSecret } from "@/lib/public-shortcut";

// The HMAC secret behind /publicshortcut, masked. Reveal and rotate are
// separate POSTs, the way Settings → MCP handles bearer tokens: a value you can
// read by loading a page is a value that leaks into a screen share.
//
// Deploy-wide (system_config, no client column) because the route it signs for
// is deploy-wide too — it serves the active client and nothing else.
export const GET = withAdmin(async () => {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, SECRET_KEY))
    .limit(1);
  if (!row) return NextResponse.json({ configured: false });
  return NextResponse.json({
    configured: true,
    masked: maskSecret(row.value),
    updatedAt: row.updatedAt,
  });
});
