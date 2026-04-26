import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/db/schema";
import { activeClientId, getActiveClient } from "@/lib/active-client";
import {
  DEFAULT_LOOK_AND_FEEL,
} from "@/db/defaults";

// Spec §17.7 — public branding endpoint.
// Returns active client's lookAndFeel + name; consumed by /login before auth.
export async function GET() {
  const cid = activeClientId();
  const rows = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, cid), inArray(config.key, ["lookAndFeel"])))
    .all();

  let lookAndFeel: unknown = DEFAULT_LOOK_AND_FEEL;
  for (const r of rows) {
    if (r.key === "lookAndFeel") {
      try {
        lookAndFeel = JSON.parse(r.value);
      } catch {
        // Ignore corrupt JSON; client-side falls back to defaults.
      }
    }
  }

  const client = getActiveClient();
  return NextResponse.json({
    clientKey: client.key,
    clientName: client.name,
    lookAndFeel,
  });
}
