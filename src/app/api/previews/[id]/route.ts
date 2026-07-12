import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews } from "@/db/schema";
import { readSession } from "@/lib/session";
import { resolveBearerClient } from "@/lib/mcp";
import { readFileBytes } from "@/lib/storage";

type Params = { id: string };

// Serves a generated message-preview PNG by message_previews.id.
// Dual auth: an app session (cookie/JWT bearer) OR the client's MCP bearer —
// the URLs are handed out by MCP list_mc, whose consumers only hold the MCP
// token. Both paths resolve to the deploy-pinned active client, so the row
// lookup below is client-scoped either way.
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const session = await readSession(req);
  const mcp = session ? null : await resolveBearerClient(req);
  if (!session && !mcp) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const clientId = session ? session.cid : mcp!.clientId;

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
      "Cache-Control": "private, max-age=300",
    },
  });
}
