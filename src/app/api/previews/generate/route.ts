import { NextResponse } from "next/server";
import { denyDemo, withSession } from "@/lib/scoped";
import { collectStalePreviews } from "@/lib/previews";
import { shootPreviews } from "@/lib/preview-shooter";

const MAX_MESSAGES = 20;

// On-demand preview generation for specific messages (editor Generate /
// Regenerate button). Synchronous: shoots in headless Chromium on this
// server, a few seconds per size. Session-only — the MCP preview_generate
// tool calls the shooter lib directly.
export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;

  const body = await req.json().catch(() => null);
  const ids = body?.message_ids;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_MESSAGES ||
    !ids.every((n) => Number.isInteger(n))
  ) {
    return NextResponse.json(
      {
        error: "bad_request",
        detail: `message_ids must be 1..${MAX_MESSAGES} integers`,
      },
      { status: 400 },
    );
  }
  const force = body?.force === true;

  const { stale, fresh } = await collectStalePreviews(claims.cid, {
    force,
    messageIds: ids as number[],
  });
  const results = await shootPreviews(claims.cid, stale);

  return NextResponse.json({ results, freshSkipped: fresh });
});
