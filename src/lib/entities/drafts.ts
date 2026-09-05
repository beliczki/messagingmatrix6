// Draft test-creatives for the agentic path (MCP `generate_test_creative`).
//
// A draft is NOT a separate table any more: it is a `messages` row with no
// audience (see the schema checks and entities/messages.ts). That is what lets
// everything here be a thin layer over the ordinary message machinery —
// previews are `message_previews` with their existing version-based staleness,
// so render progress is DERIVED from which sizes have a fresh row rather than
// tracked in a job table or a render_status column.
//
// What this module still owns is the up-front VALIDATION: an agent gets one
// actionable error listing every problem, instead of a row that renders broken.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { messagePreviews, messages, type Message } from "@/db/schema";
import { createDraft } from "@/lib/entities/messages";
import { getFileByFilename } from "@/lib/entities/files";
import { collectStalePreviews } from "@/lib/previews";
import { shootPreviews } from "@/lib/preview-shooter";
import { readTemplate } from "@/lib/templates";

export class DraftError extends Error {}

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

export type TestCreativeInput = { template: string; sizes?: string[] } & Partial<
  Record<(typeof DRAFT_TEXT_FIELDS)[number], string>
> &
  Partial<Record<(typeof DRAFT_IMAGE_FIELDS)[number], string>>;

export type DraftPreviewRow = {
  id: number;
  size: string;
  messageVersion: number;
  updatedAt: string;
};

/** Every size the draft's template defines, or [] when it has no html template. */
export function draftSizes(draft: Message): string[] {
  if (!draft.template) return [];
  const t = readTemplate(draft.template);
  return t && t.kind === "html" ? t.sizes : [];
}

// All-or-nothing validation: every problem is collected and reported in one
// error so the calling agent can fix its input in a single round.
export async function createTestCreative(
  clientId: number,
  input: TestCreativeInput,
): Promise<{ draft: Message; sizes: string[] }> {
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

  const requested = input.sizes ?? template.sizes;
  if (requested.length === 0) {
    problems.push("sizes must name at least one size");
  }
  const badSizes = requested.filter((s) => !template.sizes.includes(s));
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

  const draft = await createDraft(clientId, {
    template: input.template,
    ...Object.fromEntries(
      [...DRAFT_TEXT_FIELDS, ...DRAFT_IMAGE_FIELDS]
        .filter((f) => input[f] != null)
        .map((f) => [f, input[f]]),
    ),
  });
  return { draft, sizes: requested };
}

/**
 * Fire-and-forget render of the given sizes. Progress is not stored: it is read
 * back off message_previews by getDraftStatus, so a render that dies with the
 * server process simply leaves those sizes missing rather than leaving a status
 * column stuck on "rendering".
 */
export async function startDraftRender(
  clientId: number,
  draftId: number,
  sizes: string[],
): Promise<void> {
  const { stale } = await collectStalePreviews(clientId, {
    messageIds: [draftId],
  });
  const wanted = stale.filter((s) => sizes.includes(s.size));
  if (wanted.length === 0) return;
  await shootPreviews(clientId, wanted);
}

export async function listDraftPreviews(
  clientId: number,
  draftIds: number[],
): Promise<Map<number, DraftPreviewRow[]>> {
  const out = new Map<number, DraftPreviewRow[]>();
  if (draftIds.length === 0) return out;
  const rows = await db
    .select({
      id: messagePreviews.id,
      messageId: messagePreviews.messageId,
      size: messagePreviews.size,
      messageVersion: messagePreviews.messageVersion,
      updatedAt: messagePreviews.updatedAt,
    })
    .from(messagePreviews)
    .where(
      and(
        eq(messagePreviews.clientId, clientId),
        inArray(messagePreviews.messageId, draftIds),
      ),
    );
  for (const r of rows) {
    const list = out.get(r.messageId) ?? [];
    list.push(r);
    out.set(r.messageId, list);
  }
  return out;
}

export type DraftStatus = {
  status: "pending" | "rendering" | "done";
  totalSizes: number;
  doneSizes: number;
  percent: number;
  previews: DraftPreviewRow[];
  /** Sizes whose stored preview predates the draft's current version. */
  staleSizes: string[];
};

/**
 * Render progress, derived rather than stored. A size counts as done when its
 * preview row was shot at the draft's CURRENT version — so editing a draft
 * makes its previews stale again, which is the same rule the matrix uses and
 * the reason there is nothing extra to keep in sync.
 */
export async function getDraftStatus(
  clientId: number,
  draftId: number,
): Promise<DraftStatus | null> {
  const [draft] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.id, draftId)))
    .limit(1);
  if (!draft || draft.status !== "DRAFT") return null;

  const previews = (await listDraftPreviews(clientId, [draftId])).get(draftId) ?? [];
  const sizes = draftSizes(draft);
  const fresh = previews.filter((p) => p.messageVersion === draft.version);
  const stale = previews.filter((p) => p.messageVersion !== draft.version);
  const doneSizes = fresh.length;
  return {
    status:
      doneSizes === 0
        ? "pending"
        : doneSizes < sizes.length
          ? "rendering"
          : "done",
    totalSizes: sizes.length,
    doneSizes,
    percent: sizes.length === 0 ? 0 : Math.round((doneSizes / sizes.length) * 100),
    previews,
    staleSizes: stale.map((p) => p.size),
  };
}
