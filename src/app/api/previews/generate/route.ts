import { NextResponse } from "next/server";
import { denyDemo, withSession } from "@/lib/scoped";
import { collectStalePreviews } from "@/lib/previews";
import { shootPreviews } from "@/lib/preview-shooter";
import { broadcast } from "@/lib/events";
import { mcLabelFor } from "@/lib/mc-label";

// Progress rides the SSE feed under its OWN entity name. Not "previews": the
// client hook invalidates [entity] on every frame, and a few hundred shots
// would mean a few hundred refetches of ["previews","status"]. Nothing queries
// this key, so the invalidation is a no-op and the detail is what matters.
const PROGRESS_ENTITY = "preview_progress";

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

  // Which MC each shot belongs to, so the toolbar can name what it is doing
  // right now rather than only counting.
  const labelByMessage = new Map<number, string>();
  for (const item of stale) {
    labelByMessage.set(item.message.id, mcLabelFor(item.message));
  }

  const results = await shootPreviews(claims.cid, stale, {
    onShot: (r) => {
      broadcast(claims.cid, {
        entity: PROGRESS_ENTITY,
        ids: [r.messageId],
        action: "shot",
        byUser: claims.sub,
        detail: {
          mcLabel: labelByMessage.get(r.messageId) ?? "",
          size: r.size,
          ok: r.ok,
          ...(r.ok ? {} : { error: r.error }),
        },
      });
    },
  });

  return NextResponse.json({ results, freshSkipped: fresh });
});
