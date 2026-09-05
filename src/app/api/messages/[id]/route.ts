import { NextResponse } from "next/server";
import {
  archiveMessage,
  getMessage,
  MessageError,
  pickWritable,
  propagateToSiblings,
  updateMessage,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import type { Message } from "@/db/schema";
import {
  missingVersion,
  readClientVersion,
  versionMismatch,
} from "@/lib/optimistic";

type Params = { id: string };

function parseId(s: string): number | null {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const GET = withSession<Params>(async ({ claims, params }) => {
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const row = await getMessage(claims.cid, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ message: row });
});

export const PATCH = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const expected = readClientVersion(req, body);
  if (expected === null) return missingVersion();
  const input = pickWritable(body);
  const before = await getMessage(claims.cid, id);
  let result: Awaited<ReturnType<typeof updateMessage>>;
  try {
    result = await updateMessage(claims.cid, id, expected, input);
  } catch (e) {
    // A DRAFT/placement mismatch is the caller's input being wrong, not a
    // server fault — surface it as a 400 with the reason, like POST does.
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: id,
    action: "update",
    before,
    after: result.row,
  });

  // Global edit: fan the shared (creative + status) fields out to every other
  // audience copy of this same card. Triggered by ?propagate=siblings. Each
  // sibling gets its own audit entry so the change shows in its history too.
  let propagated = 0;
  let siblings: Message[] = [];
  if (new URL(req.url).searchParams.get("propagate") === "siblings") {
    const changes = await propagateToSiblings(claims.cid, result.row, input);
    for (const c of changes) {
      await writeAudit({
        clientId: claims.cid,
        userId: claims.sub,
        entityType: "messages",
        entityId: c.after.id,
        action: "update",
        before: c.before,
        after: c.after,
      });
    }
    propagated = changes.length;
    // Return the updated sibling rows so the client can patch them straight
    // into its cache — the primary alone would leave the other audience copies
    // stale until the next full /api/messages refetch (heavy: every row).
    siblings = changes.map((c) => c.after);
  }

  return NextResponse.json({ message: result.row, propagated, siblings });
});

export const DELETE = withSession<Params>(async ({ req, claims, params }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const expected = readClientVersion(req, null);
  if (expected === null) return missingVersion();
  const before = await getMessage(claims.cid, id);
  const result = await archiveMessage(claims.cid, id, expected);
  if (!result.ok) {
    if (!result.current) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return versionMismatch(result.current, result.current.version);
  }
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: id,
    action: "archive",
    before,
    after: result.row,
  });
  return NextResponse.json({ message: result.row });
});
