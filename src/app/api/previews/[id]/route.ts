import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { readFileBytes } from "@/lib/storage";

type Params = { id: string };

// Serves a generated message-preview PNG by message_previews.id — for the app
// itself, which reaches it from a logged-in browser.
//
// Public until 2026-09-24, when the user asked for the old route to be signed
// too. It is session-protected instead of signed: the in-app <img src> carries
// the auth cookie on its own, so the signing secret never has to reach a
// browser. Everyone OUTSIDE the app gets a signed /publicshortcut/m<id>.<sig>
// URL instead, which is the one an agent can compute for itself.
//
// This broke every /api/previews/<id> link handed out before that date. That
// was the point of the decision, not a side effect of it.
//
// Cache-Control stays `public` — it describes a shared cache's rights over the
// bytes, not who may ask for them.
export const GET = withSession<Params>(async ({ claims, params }) => {
  const numId = Number(params.id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [row] = await db
    .select()
    .from(messagePreviews)
    .where(
      and(
        eq(messagePreviews.clientId, claims.cid),
        eq(messagePreviews.id, numId),
      ),
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
});
