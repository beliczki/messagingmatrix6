import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { archiveMessages, deleteMessages } from "@/lib/entities/messages";
import { denyDemo, withSession } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

// mode "archive" → soft (archived_at, restorable from "Show archived").
// mode "purge"   → hard (row gone; only the audit entry keeps the before-state).
const Body = z.object({
  mode: z.enum(["archive", "purge"]),
  items: z
    .array(
      z.object({
        mc_label: z.string(),
        version: z.number().int(),
      }),
    )
    .min(1),
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

  const { mode, items } = parsed.data;
  const removals = items.map((i) => ({
    mcLabel: i.mc_label,
    expectedVersion: i.version,
  }));

  const result = await db.transaction(async () =>
    mode === "archive"
      ? archiveMessages(claims.cid, removals)
      : deleteMessages(claims.cid, removals),
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
      case "row_locked_by_status":
        return NextResponse.json(
          {
            error: "row_locked_by_status",
            mc_label: result.mcLabel,
            status: result.status,
          },
          { status: 409 },
        );
      case "creative_linked":
        return NextResponse.json(
          {
            error: "creative_linked",
            mc_label: result.mcLabel,
            creative_count: result.creativeCount,
          },
          { status: 409 },
        );
    }
  }

  if (mode === "purge") {
    // Per-row entries with the full before-state: after a hard delete the audit
    // log is the only remaining record of what the card was.
    for (const row of result.rows) {
      await writeAudit({
        clientId: claims.cid,
        userId: claims.sub,
        entityType: "messages",
        entityId: row.id,
        action: "delete",
        before: row,
      });
    }
  } else {
    await writeAudit({
      clientId: claims.cid,
      userId: claims.sub,
      entityType: "messages",
      entityId: `bulk:${claims.cid}`,
      action: "bulk_archive",
      after: {
        count: result.rows.length,
        ids: result.rows.map((r) => r.id),
      },
    });
  }

  return NextResponse.json({ mode, rows: result.rows });
});
