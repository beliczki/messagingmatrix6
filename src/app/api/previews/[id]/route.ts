import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";
import { readFileBytes } from "@/lib/storage";

type Params = { id: string };

// Serves a generated message-preview PNG by message_previews.id.
// Deliberately public (user decision, 2026-07-15): the URLs are handed out by
// MCP list_mc and consumed by agents/tools that can't always attach auth, and
// the images are previews only. The row lookup stays scoped to the
// deploy-pinned active client, so this deploy never serves another client's
// previews. Generation/status routes remain session-protected.
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
    .from(messagePreviews)
    .where(
      and(eq(messagePreviews.clientId, clientId), eq(messagePreviews.id, numId)),
    )
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
      // The row id is stable across regens while bytes change — keep it short.
      "Cache-Control": "public, max-age=300",
    },
  });
}
