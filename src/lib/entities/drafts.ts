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
import { createDraft, getMessage, updateMessage } from "@/lib/entities/messages";
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

/** The draft's html template, or a DraftError naming why it isn't usable. */
function requireHtmlTemplate(name: string) {
  const template = readTemplate(name);
  if (!template) {
    throw new DraftError(`template '${name}' not found`);
  }
  if (template.kind !== "html") {
    throw new DraftError(
      `template '${name}' is kind '${template.kind}' — only html templates have sized renders`,
    );
  }
  return template;
}

// All-or-nothing validation, shared by create and update: every problem is
// collected and reported in one error so the calling agent can fix its input in
// a single round. Only the parts of `input` that are PRESENT are checked — that
// is what lets an update validate a patch by the same rules as a create.
async function collectContentProblems(
  clientId: number,
  templateName: string,
  template: { sizes: string[]; tagOptions: string[] },
  input: Partial<TestCreativeInput>,
  sizes: string[],
): Promise<string[]> {
  const problems: string[] = [];

  if (sizes.length === 0) {
    problems.push("sizes must name at least one size");
  }
  const badSizes = sizes.filter((s) => !template.sizes.includes(s));
  if (badSizes.length > 0) {
    problems.push(
      `unknown size(s) ${badSizes.join(", ")} — template '${templateName}' has: ${template.sizes.join(", ")}`,
    );
  }

  const tags = (input.templateVariantClasses ?? "").split(/\s+/).filter(Boolean);
  const badTags = tags.filter((t) => !template.tagOptions.includes(t));
  if (badTags.length > 0) {
    problems.push(
      `unknown template_variant_classes token(s) ${badTags.join(", ")} — template '${templateName}' accepts: ${template.tagOptions.join(", ")}`,
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

  return problems;
}

export async function createTestCreative(
  clientId: number,
  input: TestCreativeInput,
): Promise<{ draft: Message; sizes: string[] }> {
  const template = requireHtmlTemplate(input.template);
  const requested = input.sizes ?? template.sizes;
  const problems = await collectContentProblems(
    clientId,
    input.template,
    template,
    input,
    requested,
  );
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
 * Edit a draft's content in place. Only the fields PRESENT in `patch` are
 * touched; an empty string clears one. The draft's template is NOT changeable
 * here — it decides which sizes and which variant-class tokens are legal, so
 * switching it is a different operation from editing what sits inside it.
 */
export async function updateTestCreative(
  clientId: number,
  draftId: number,
  patch: Partial<Omit<TestCreativeInput, "template" | "sizes">>,
  opts: { sizes?: string[]; expectedVersion?: number } = {},
): Promise<{ draft: Message; sizes: string[] }> {
  const existing = await getMessage(clientId, draftId);
  if (!existing || existing.status !== "DRAFT" || existing.audience !== null) {
    throw new DraftError(`draft ${draftId} not found`);
  }
  if (existing.archivedAt !== null) {
    throw new DraftError(
      `MC${existing.number}${existing.variant} is archived — restore it before editing`,
    );
  }
  if (!existing.template) {
    throw new DraftError(
      `draft ${draftId} has no template — it was not created by generate_test_creative, so there is nothing sized to render`,
    );
  }
  const templateName = existing.template;
  const template = requireHtmlTemplate(templateName);

  // The tokens are validated as the draft will END UP, not as they arrive: a
  // patch that leaves them alone must not be judged against an empty string.
  const merged: Partial<TestCreativeInput> = {
    ...Object.fromEntries(
      DRAFT_IMAGE_FIELDS.filter((f) => existing[f] != null).map((f) => [
        f,
        existing[f],
      ]),
    ),
    templateVariantClasses: existing.templateVariantClasses ?? undefined,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ),
  };
  const sizes = opts.sizes ?? draftSizes(existing);
  const problems = await collectContentProblems(
    clientId,
    templateName,
    template,
    merged,
    sizes,
  );
  if (problems.length > 0) throw new DraftError(problems.join("; "));

  // "" clears a column; an absent key leaves it alone.
  const fields = Object.fromEntries(
    Object.entries(patch)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v === "" ? null : v]),
  );
  if (Object.keys(fields).length === 0) {
    return { draft: existing, sizes };
  }
  const res = await updateMessage(
    clientId,
    draftId,
    opts.expectedVersion ?? existing.version,
    fields,
  );
  if (!res.ok) {
    throw new DraftVersionConflict(res.current);
  }
  return { draft: res.row, sizes };
}

/** Raised when a draft edit loses the optimistic lock; carries the current row. */
export class DraftVersionConflict extends Error {
  constructor(public current: Message | null) {
    super("version_conflict");
  }
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
