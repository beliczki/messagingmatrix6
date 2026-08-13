// Draft test-creatives (MCP `generate_test_creative`) — staging rows outside
// the matrix. Created with full validation up front (template / sizes / tag
// tokens / image filenames) so an agent gets one actionable error instead of
// a broken render. Rendering is async: startDraftRender is fired-and-forgotten
// by the MCP tool and progress is derived from draft_previews row counts
// (see getDraftStatus) — no job table.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  draftMessages,
  draftPreviews,
  nowUtc,
  type Message,
} from "@/db/schema";
import { getFileByFilename } from "@/lib/entities/files";
import { shootItems } from "@/lib/preview-shooter";
import { writeFile as writeStorageFile, deleteStorageFile } from "@/lib/storage";
import { readTemplate } from "@/lib/templates";
import { createMessage } from "./messages";

export class DraftError extends Error {}

export type DraftMessage = typeof draftMessages.$inferSelect;
export type DraftPreview = typeof draftPreviews.$inferSelect;

// Rendering is considered stalled when the in-process render promise died
// (pm2 restart) — detected as "rendering" for longer than this with sizes
// still missing. Computed in getDraftStatus, never stored.
const STALLED_AFTER_SECONDS = 10 * 60;

const DRAFT_TEXT_FIELDS = [
  "name",
  "templateVariantClasses",
  "headline",
  "copy1",
  "copy2",
  "disclaimer",
  "cta",
  "flash",
  "headlineStyle",
  "copy1Style",
  "copy2Style",
  "disclaimerStyle",
  "ctaStyle",
  "flashStyle",
  "customCss",
] as const;

const DRAFT_IMAGE_FIELDS = [
  "image1",
  "image2",
  "image3",
  "image4",
  "image5",
  "image6",
] as const;

export type DraftInput = { template: string; sizes: string[] } & Partial<
  Record<(typeof DRAFT_TEXT_FIELDS)[number], string>
> &
  Partial<Record<(typeof DRAFT_IMAGE_FIELDS)[number], string>>;

// All-or-nothing validation: every problem is collected and reported in one
// error so the calling agent can fix its input in a single round.
export async function createDraft(
  clientId: number,
  input: DraftInput,
): Promise<DraftMessage> {
  const template = readTemplate(input.template);
  if (!template) {
    throw new DraftError(`template '${input.template}' not found`);
  }
  if (template.kind !== "html") {
    throw new DraftError(
      `template '${input.template}' is kind '${template.kind}' — only html templates have sized renders`,
    );
  }

  const problems: string[] = [];

  if (input.sizes.length === 0) {
    problems.push("sizes must name at least one size");
  }
  const badSizes = input.sizes.filter((s) => !template.sizes.includes(s));
  if (badSizes.length > 0) {
    problems.push(
      `unknown size(s) ${badSizes.join(", ")} — template '${input.template}' has: ${template.sizes.join(", ")}`,
    );
  }

  const tags = (input.templateVariantClasses ?? "").split(/\s+/).filter(Boolean);
  const badTags = tags.filter((t) => !template.tagOptions.includes(t));
  if (badTags.length > 0) {
    problems.push(
      `unknown template_variant_classes token(s) ${badTags.join(", ")} — template '${input.template}' accepts: ${template.tagOptions.join(", ")}`,
    );
  }

  const missingFiles: string[] = [];
  for (const field of DRAFT_IMAGE_FIELDS) {
    const name = input[field];
    if (!name) continue;
    if (!(await getFileByFilename(clientId, name))) missingFiles.push(name);
  }
  if (missingFiles.length > 0) {
    problems.push(
      `image file(s) not found: ${missingFiles.join(", ")} — upload them first (asset_upload) and pass the stored filename`,
    );
  }

  if (problems.length > 0) throw new DraftError(problems.join("; "));

  const [row] = await db
    .insert(draftMessages)
    .values({
      clientId,
      template: input.template,
      sizes: JSON.stringify(input.sizes),
      ...Object.fromEntries(
        [...DRAFT_TEXT_FIELDS, ...DRAFT_IMAGE_FIELDS]
          .filter((f) => input[f] !== undefined)
          .map((f) => [f, input[f]]),
      ),
    })
    .returning();
  return row!;
}

// Render every requested size to a PNG. Fired-and-forgotten by the MCP tool
// (`void startDraftRender(...)`); progress = draft_previews rows appearing.
// Queues on the shared shooter mutex behind message-preview batches.
export async function startDraftRender(
  clientId: number,
  draft: DraftMessage,
  opts: { baseUrl?: string } = {},
): Promise<void> {
  await db
    .update(draftMessages)
    .set({ renderStatus: "rendering", renderStartedAt: nowUtc, updatedAt: nowUtc })
    .where(eq(draftMessages.id, draft.id));

  const sizes = JSON.parse(draft.sizes) as string[];
  const results = await shootItems(
    clientId,
    sizes.map((size) => ({
      template: draft.template,
      row: draft as unknown as Record<string, unknown>,
      size,
      persist: async (buf) => {
        const stored = await writeStorageFile(buf, "preview", ".png");
        const [row] = await db
          .insert(draftPreviews)
          .values({
            clientId,
            draftId: draft.id,
            size,
            storageKey: stored.storagePath,
          })
          .returning();
        return { id: row!.id, updatedAt: row!.updatedAt };
      },
    })),
    { baseUrl: opts.baseUrl },
  );

  const errors = Object.fromEntries(
    results.filter((r) => !r.ok).map((r) => [r.size, (r as { error: string }).error]),
  );
  const anyOk = results.some((r) => r.ok);
  await db
    .update(draftMessages)
    .set({
      renderStatus: anyOk ? "done" : "failed",
      renderError: Object.keys(errors).length > 0 ? JSON.stringify(errors) : null,
      updatedAt: nowUtc,
    })
    .where(eq(draftMessages.id, draft.id));
}

export type DraftStatus = {
  draft: DraftMessage;
  previews: DraftPreview[];
  // "pending" | "rendering" | "done" | "failed" | "stalled"
  status: string;
  totalSizes: number;
  doneSizes: number;
  percent: number;
  elapsedSeconds: number | null;
  errors: Record<string, string>;
};

function parseUtc(ts: string): number {
  return new Date(ts.replace(" ", "T") + "Z").getTime();
}

export async function getDraftStatus(
  clientId: number,
  id: number,
): Promise<DraftStatus | null> {
  const draft = await getDraftRow(clientId, id);
  if (!draft) return null;
  const previews = await listDraftPreviews(clientId, id);

  const totalSizes = (JSON.parse(draft.sizes) as string[]).length;
  const doneSizes = previews.length;
  const elapsedSeconds = draft.renderStartedAt
    ? Math.max(0, Math.round((Date.now() - parseUtc(draft.renderStartedAt)) / 1000))
    : null;

  let status = draft.renderStatus;
  if (
    status === "rendering" &&
    elapsedSeconds !== null &&
    elapsedSeconds > STALLED_AFTER_SECONDS &&
    doneSizes < totalSizes
  ) {
    // The in-process render promise is gone (server restart) — the row would
    // say "rendering" forever. Recreating the draft is the v1 recovery path.
    status = "stalled";
  }

  return {
    draft,
    previews,
    status,
    totalSizes,
    doneSizes,
    percent: totalSizes === 0 ? 100 : Math.round((doneSizes / totalSizes) * 100),
    elapsedSeconds,
    errors: draft.renderError ? (JSON.parse(draft.renderError) as Record<string, string>) : {},
  };
}

async function getDraftRow(
  clientId: number,
  id: number,
): Promise<DraftMessage | null> {
  const [row] = await db
    .select()
    .from(draftMessages)
    .where(and(eq(draftMessages.clientId, clientId), eq(draftMessages.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listDraftPreviews(
  clientId: number,
  draftId: number,
): Promise<DraftPreview[]> {
  return db
    .select()
    .from(draftPreviews)
    .where(
      and(eq(draftPreviews.clientId, clientId), eq(draftPreviews.draftId, draftId)),
    )
    .orderBy(draftPreviews.size);
}

// Bulk variant for the drafts list view — one query instead of per-draft.
export async function listPreviewsForDrafts(
  clientId: number,
  draftIds: number[],
): Promise<DraftPreview[]> {
  if (draftIds.length === 0) return [];
  return db
    .select()
    .from(draftPreviews)
    .where(
      and(
        eq(draftPreviews.clientId, clientId),
        inArray(draftPreviews.draftId, draftIds),
      ),
    )
    .orderBy(draftPreviews.size);
}

export async function listDrafts(
  clientId: number,
  opts: { includePromoted?: boolean; limit?: number } = {},
): Promise<DraftMessage[]> {
  return db
    .select()
    .from(draftMessages)
    .where(
      and(
        eq(draftMessages.clientId, clientId),
        ...(opts.includePromoted ? [] : [isNull(draftMessages.promotedMessageId)]),
      ),
    )
    .orderBy(desc(draftMessages.id))
    .limit(Math.min(opts.limit ?? 500, 1000));
}

export async function getDraft(
  clientId: number,
  id: number,
): Promise<{ draft: DraftMessage; previews: DraftPreview[] } | null> {
  const draft = await getDraftRow(clientId, id);
  if (!draft) return null;
  return { draft, previews: await listDraftPreviews(clientId, id) };
}

// Hard delete (deliberate departure from the archivedAt convention — drafts
// are throwaway staging). Row first (version-checked, previews cascade), then
// the storage objects: a crash in between orphans regenerable PNGs at worst,
// never rows pointing at deleted bytes (same ordering principle as the
// shooter's "row points at the new object before the old one is deleted").
export async function deleteDraft(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  | { ok: true; draft: DraftMessage }
  | { ok: false; current: DraftMessage | null }
> {
  const previews = await listDraftPreviews(clientId, id);
  const [deleted] = await db
    .delete(draftMessages)
    .where(
      and(
        eq(draftMessages.clientId, clientId),
        eq(draftMessages.id, id),
        eq(draftMessages.version, expectedVersion),
      ),
    )
    .returning();
  if (!deleted) {
    return { ok: false, current: await getDraftRow(clientId, id) };
  }
  for (const p of previews) {
    await deleteStorageFile(p.storageKey);
  }
  return { ok: true, draft: deleted };
}

// Promote a draft into the matrix: a real messages row at (audience, topic)
// via createMessage (numbering / pmmid / trafficking all standard), with the
// draft back-linked through promotedMessageId as the double-promote guard.
// The draft row stays (previews keep serving) — same philosophy as
// promoteCreative, where the source record remains the file record.
export async function promoteDraft(
  clientId: number,
  draftId: number,
  opts: {
    audienceKey: string;
    topicKey: string;
    requestedNumber?: number | "new";
    requestedVariant?: string;
  },
): Promise<{ message: Message; draft: DraftMessage }> {
  const draft = await getDraftRow(clientId, draftId);
  if (!draft) throw new DraftError(`draft ${draftId} not found`);
  if (draft.promotedMessageId != null) {
    throw new DraftError(
      `draft ${draftId} is already promoted (message ${draft.promotedMessageId})`,
    );
  }

  return db.transaction(async () => {
    const message = await createMessage(
      clientId,
      {
        audience: opts.audienceKey,
        topic: opts.topicKey,
        template: draft.template,
        ...Object.fromEntries(
          [...DRAFT_TEXT_FIELDS, ...DRAFT_IMAGE_FIELDS]
            .filter((f) => f !== "name" && draft[f] != null)
            .map((f) => [f, draft[f]]),
        ),
        name: draft.name ?? undefined,
      },
      {
        requestedNumber: opts.requestedNumber,
        requestedVariant: opts.requestedVariant,
      },
    );

    const [updated] = await db
      .update(draftMessages)
      .set({
        promotedMessageId: message.id,
        version: draft.version + 1,
        updatedAt: nowUtc,
      })
      .where(
        and(
          eq(draftMessages.id, draftId),
          eq(draftMessages.version, draft.version),
        ),
      )
      .returning();
    if (!updated) {
      throw new DraftError(
        `draft ${draftId} changed concurrently during promotion — retry`,
      );
    }
    return { message, draft: updated };
  });
}
