import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemConfig, nowUtc } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import {
  SECRET_KEY,
  ensureSecret,
  generateSecret,
  maskSecret,
} from "@/lib/public-shortcut";

// Rotating invalidates EVERY link already handed out — there is no per-link
// revocation, which is the price of URLs nobody has to store. The UI says so
// before it calls this; the audit entry records both masks so the change can be
// placed in time afterwards.
export const POST = withAdmin(async ({ claims }) => {
  const before = await ensureSecret();
  const secret = generateSecret();
  await db
    .update(systemConfig)
    .set({ value: secret, updatedAt: nowUtc })
    .where(eq(systemConfig.key, SECRET_KEY));

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "system_config",
    entityId: "public_shortcut_secret",
    // "update" rather than a new audit verb for one call site — the entity and
    // its id already say exactly what changed.
    action: "update",
    before: { secret: maskSecret(before) },
    after: { secret: maskSecret(secret) },
  });
  return NextResponse.json({ secret });
});
