import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { messages, messagePreviews } from "@/db/schema";
import { withSession } from "@/lib/scoped";
import { collectStalePreviews } from "@/lib/previews";
import { mcLabelFor } from "@/lib/mc-label";
import { readTemplate } from "@/lib/templates";

// No param: feeds the creative-library "missing previews" warning — which
// html MCs have at least one absent-or-stale size preview, and which sizes.
// ?message_id=<id>: per-size detail for one message (editor Image preview).
export const GET = withSession(async ({ req, claims }) => {
  const messageIdParam = req.nextUrl.searchParams.get("message_id");
  if (messageIdParam !== null) {
    const messageId = Number(messageIdParam);
    if (!Number.isInteger(messageId)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.clientId, claims.cid),
          eq(messages.id, messageId),
          isNull(messages.archivedAt),
        ),
      )
      .limit(1);
    if (!message) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const template = message.template ? readTemplate(message.template) : null;
    if (!template || template.kind !== "html") {
      // Non-html templates have no sized renders, so no previews exist.
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(messagePreviews)
      .where(
        and(
          eq(messagePreviews.clientId, claims.cid),
          eq(messagePreviews.messageId, messageId),
        ),
      );
    const bySize = new Map(rows.map((r) => [r.size, r]));

    return NextResponse.json({
      messageId,
      version: message.version,
      sizes: template.sizes.map((size) => {
        const row = bySize.get(size);
        return {
          size,
          previewId: row?.id ?? null,
          stale: !row || row.messageVersion !== message.version,
          updatedAt: row?.updatedAt ?? null,
        };
      }),
    });
  }

  const { stale, fresh } = await collectStalePreviews(claims.cid);

  const byMessage = new Map<number, { mcLabel: string; sizes: string[] }>();
  for (const item of stale) {
    const entry = byMessage.get(item.message.id) ?? {
      mcLabel: mcLabelFor(item.message),
      sizes: [],
    };
    entry.sizes.push(item.size);
    byMessage.set(item.message.id, entry);
  }
  const offenders = [...byMessage.values()].sort((a, b) =>
    a.mcLabel.localeCompare(b.mcLabel),
  );

  return NextResponse.json({
    staleCount: stale.length,
    freshCount: fresh,
    mcCount: offenders.length,
    offenders,
  });
});
