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

  // Group by MC LABEL, not by message row. A single MC number+variant
  // legitimately exists as many `messages` rows (one per audience column — card
  // fan-out = copy), so keying by message.id counted the same MC many times and
  // the "N MCs missing previews" badge over-reported. Union the sizes per label.
  const byLabel = new Map<string, Set<string>>();
  for (const item of stale) {
    const label = mcLabelFor(item.message);
    const sizes = byLabel.get(label) ?? new Set<string>();
    sizes.add(item.size);
    byLabel.set(label, sizes);
  }
  const offenders = [...byLabel.entries()]
    .map(([mcLabel, sizes]) => ({ mcLabel, sizes: [...sizes].sort() }))
    .sort((a, b) => a.mcLabel.localeCompare(b.mcLabel));

  return NextResponse.json({
    // staleCount stays a per-row-per-size count (genuine); mcCount is now the
    // number of DISTINCT MC labels with at least one absent/stale size.
    staleCount: stale.length,
    freshCount: fresh,
    mcCount: offenders.length,
    offenders,
  });
});
