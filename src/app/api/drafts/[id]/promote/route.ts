import { NextResponse } from "next/server";
import { DraftError, promoteDraft } from "@/lib/entities/drafts";
import { MessageError } from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type Params = { id: string };

// Promote a draft test-creative into the matrix: body { audienceKey, topicKey,
// mcNumber? (int | "new"), variant? } — same allocation semantics as message
// creation. Returns the new message + the back-linked draft.
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
  const { audienceKey, topicKey, mcNumber, variant } = body as Record<
    string,
    unknown
  >;
  if (typeof audienceKey !== "string" || typeof topicKey !== "string") {
    return NextResponse.json(
      { error: "audienceKey and topicKey are required" },
      { status: 400 },
    );
  }
  try {
    const result = await promoteDraft(claims.cid, id, {
      audienceKey,
      topicKey,
      requestedNumber:
        mcNumber === "new"
          ? "new"
          : typeof mcNumber === "number"
            ? mcNumber
            : undefined,
      requestedVariant: typeof variant === "string" ? variant : undefined,
    });
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: result.message.id,
      action: "create",
      after: result.message,
    });
    return NextResponse.json(
      { message: result.message, draft: result.draft },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof DraftError || e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
