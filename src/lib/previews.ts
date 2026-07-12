// Preview staleness scan — shared by scripts/gen-previews.ts (decides what to
// shoot) and GET /api/previews/status (feeds the creative-library warning).
//
// A (message, size) preview is STALE when it has no message_previews row or
// the row's message_version differs from the message's current `version` (the
// optimistic-lock int any edit bumps). Only non-archived messages whose
// template resolves to kind=html count — other kinds have no sized renders.
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { messages, messagePreviews } from "@/db/schema";
import { readTemplate } from "@/lib/templates";

const PAGE_SIZE = 500; // messages per scan page (row-cap rule)

export type StalePreview = {
  message: typeof messages.$inferSelect;
  size: string;
  existing: { id: number; storageKey: string } | null;
};

// opts.force treats every (message, size) as stale — used by
// `npm run gen:previews -- --force` to reshoot after a render/template change
// or THM copy drift, neither of which bumps messages.version. Existing rows
// stay attached so their old objects get replaced, not orphaned.
export async function collectStalePreviews(
  clientId: number,
  opts: { force?: boolean } = {},
): Promise<{ stale: StalePreview[]; fresh: number }> {
  // Template sizes cached per call, not per module — templates live on the
  // filesystem and can change under a long-running server process.
  const sizeCache = new Map<string, string[] | null>();
  function htmlTemplateSizes(name: string): string[] | null {
    if (!sizeCache.has(name)) {
      const t = readTemplate(name);
      sizeCache.set(name, t && t.kind === "html" ? t.sizes : null);
    }
    return sizeCache.get(name)!;
  }

  const stale: StalePreview[] = [];
  let fresh = 0;
  let lastId = 0;
  for (;;) {
    const batch = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          isNull(messages.archivedAt),
          gt(messages.id, lastId),
        ),
      )
      .orderBy(messages.id)
      .limit(PAGE_SIZE);
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]!.id;

    const withTemplate = batch.filter((m) => m.template && htmlTemplateSizes(m.template));
    const ids = withTemplate.map((m) => m.id);
    const rows = ids.length
      ? await db
          .select()
          .from(messagePreviews)
          .where(and(eq(messagePreviews.clientId, clientId), inArray(messagePreviews.messageId, ids)))
      : [];
    const byKey = new Map(rows.map((r) => [`${r.messageId}|${r.size}`, r]));

    for (const m of withTemplate) {
      for (const size of htmlTemplateSizes(m.template!)!) {
        const row = byKey.get(`${m.id}|${size}`);
        if (!opts.force && row && row.messageVersion === m.version) {
          fresh++;
        } else {
          stale.push({
            message: m,
            size,
            existing: row ? { id: row.id, storageKey: row.storageKey } : null,
          });
        }
      }
    }
    if (batch.length < PAGE_SIZE) break;
  }
  return { stale, fresh };
}
