import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { draftPreviews } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import { readFileBytes } from "@/lib/storage";

type Params = { id: string };

// Serves a generated draft-creative PNG by draft_previews.id. Deliberately
// public, same rationale as /api/previews/[id] (user decision, 2026-07-15):
// the URLs are handed out by MCP draft_status / show_draft_previews and
// consumed by agents/tools that can't always attach auth. The row lookup
// stays scoped to the deploy-pinned active client.
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const clientId = await activeClientId();

  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [row] = await db
    .select()
    .from(draftPreviews)
    .where(and(eq(draftPreviews.clientId, clientId), eq(draftPreviews.id, numId)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFileBytes(row.storageKey);
  } catch {
    return NextResponse.json({ error: "storage_missing" }, { status: 410 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=300",
    },
  });
}
