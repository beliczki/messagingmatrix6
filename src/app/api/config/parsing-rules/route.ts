import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { DEFAULT_CREATIVE_PARSING_RULES } from "@/db/defaults";

// Returns config.creativeParsingRules for the active client, falling back to
// defaults so a fresh client still has working filename parsing.
export const GET = withSession(async ({ claims }) => {
  const [row] = await db
    .select()
    .from(config)
    .where(
      and(
        eq(config.clientId, claims.cid),
        eq(config.key, "creativeParsingRules"),
      ),
    )
    .limit(1);
  let rules: unknown = DEFAULT_CREATIVE_PARSING_RULES;
  if (row) {
    try {
      rules = JSON.parse(row.value);
    } catch {
      // fall back to defaults on corrupt JSON
    }
  }
  return NextResponse.json({ rules });
});
