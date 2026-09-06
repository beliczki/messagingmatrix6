import { NextResponse } from "next/server";
import {
  copyMessages,
  getMessage,
  MessageError,
  promoteDraft,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

// Place a draft into a cell:
//   { audienceKey, topicKey, target?, agenticAudienceKey?, status?, version? }
//
// The row is UPDATED rather than replaced, so the audit entry is an `update` on
// the message that already existed — the draft and the card are one MC.
//
// `target` names which world the work lands in. "dco" and "agentic" differ only
// in which audience is passed: promoteDraft resolves channel-audiences through
// the same lookup, so an Agentic placement is an ordinary promote onto a
// channel. "both" is promote + COPY, not two promotes: a draft is one row and
// can only become one card, and copy is what makes the second axis a clone of
// the first rather than an unrelated card that happens to share a number. The
// order matters — while the row is still a draft it holds its number on EVERY
// axis, so the copy has to follow the promote.
const TARGETS = ["dco", "agentic", "both"] as const;
type Target = (typeof TARGETS)[number];

export const POST = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const {
    audienceKey,
    topicKey,
    target: targetRaw,
    agenticAudienceKey,
    status,
    version,
  } = body as Record<string, unknown>;
  if (typeof audienceKey !== "string" || typeof topicKey !== "string") {
    return NextResponse.json(
      { error: "audienceKey and topicKey are required" },
      { status: 400 },
    );
  }
  // Omitted target keeps the original one-cell behaviour, which is what every
  // caller that predates this parameter (MCP, the old drafts dialog) sends.
  const target: Target =
    typeof targetRaw === "string" && (TARGETS as readonly string[]).includes(targetRaw)
      ? (targetRaw as Target)
      : "dco";
  if (target === "both" && typeof agenticAudienceKey !== "string") {
    return NextResponse.json(
      { error: "agenticAudienceKey is required when target is 'both'" },
      { status: 400 },
    );
  }

  const before = await getMessage(claims.cid, id);
  try {
    const row = await promoteDraft(claims.cid, id, {
      audienceKey,
      topicKey,
      status: typeof status === "string" ? status : undefined,
      expectedVersion: typeof version === "number" ? version : undefined,
    });
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: id,
      action: "update",
      before,
      after: row,
    });

    if (target !== "both") {
      return NextResponse.json({ message: row });
    }

    // The twin. Copy resolves its source BY PMMID, which the promote above is
    // what mints — before it, the draft has none by database check.
    const { created } = await copyMessages(
      claims.cid,
      [row.pmmid!],
      [agenticAudienceKey as string],
    );
    for (const twin of created) {
      await writeAudit({
        clientId: claims.cid,
        userId: claims.sub,
        entityType: "messages",
        entityId: twin.id,
        action: "create",
        after: twin,
      });
    }
    return NextResponse.json({ message: row, twins: created });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
