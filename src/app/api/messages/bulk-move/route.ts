import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { moveMessages } from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  moves: z
    .array(
      z.object({
        mc_label: z.string(),
        version: z.number().int(),
      }),
    )
    .min(1),
  target_audience_key: z.string(),
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

  const result = await db.transaction(async () =>
    moveMessages(
      claims.cid,
      parsed.data.moves.map((m) => ({
        mcLabel: m.mc_label,
        expectedVersion: m.version,
      })),
      parsed.data.target_audience_key,
    ),
  );

  if (!result.ok) {
    switch (result.reason) {
      case "version_conflict":
        return NextResponse.json(
          {
            error: "version_conflict",
            mc_label: result.mcLabel,
            currentRow: result.current,
            currentVersion: result.current?.version,
          },
          { status: 409 },
        );
      case "not_found":
        return NextResponse.json(
          { error: "not_found", mc_label: result.mcLabel },
          { status: 404 },
        );
      case "cross_topic_move_not_supported":
      case "target_audience_not_found":
        return NextResponse.json(
          { error: result.reason, mc_label: result.mcLabel },
          { status: 400 },
        );
      case "row_locked_by_status":
        return NextResponse.json(
          {
            error: "row_locked_by_status",
            mc_label: result.mcLabel,
            status: result.status,
          },
          { status: 409 },
        );
    }
  }

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "messages",
    entityId: `bulk:${claims.cid}`,
    action: "bulk_move",
    after: {
      count: result.updated.length,
      ids: result.updated.map((r) => r.id),
    },
  });
  return NextResponse.json({ updated: result.updated });
});
