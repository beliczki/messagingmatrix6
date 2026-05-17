import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  copyMessages,
  MessageError,
  pickWritable,
} from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  source_mc_labels: z.array(z.string()).min(1),
  target_audience_keys: z.array(z.string()).min(1),
  field_overrides: z.record(z.string(), z.unknown()).optional(),
});

export const POST = withSession(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = db.transaction(() =>
      copyMessages(
        claims.cid,
        parsed.data.source_mc_labels,
        parsed.data.target_audience_keys,
        { fieldOverrides: pickWritable(parsed.data.field_overrides ?? {}) },
      ),
    );
    writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: `bulk:${claims.cid}`,
      action: "bulk_copy",
      after: {
        count: result.created.length,
        ids: result.created.map((r) => r.id),
      },
    });
    return NextResponse.json({ created: result.created }, { status: 201 });
  } catch (e) {
    if (e instanceof MessageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
});
