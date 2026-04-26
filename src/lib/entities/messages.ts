import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  config,
  messages,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "@/db/schema";
import { nextMcSlot, type ExistingMessage } from "@/lib/numbering";
import { generatePmmid } from "@/lib/pmmid";
import {
  generateTrafficking,
  type TraffickingPatterns,
} from "@/lib/trafficking";

const WRITABLE_FIELDS = [
  "audience",
  "topic",
  "status",
  "startDate",
  "endDate",
  "template",
  "templateVariantClasses",
  "name",
  "headline",
  "copy1",
  "copy2",
  "disclaimer",
  "headlineStyle",
  "copy1Style",
  "copy2Style",
  "disclaimerStyle",
  "ctaStyle",
  "customCss",
  "image1",
  "image2",
  "image3",
  "image4",
  "image5",
  "image6",
  "video1",
  "flash",
  "flashStyle",
  "cta",
  "landingUrl",
  "comment",
  "brief",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type MessageInput = Partial<Pick<Message, WritableField>>;

export function pickWritable(input: unknown): MessageInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as MessageInput;
}

export class MessageError extends Error {}

type ClientPatterns = {
  pmmid?: string;
  trafficking?: TraffickingPatterns;
};

function readClientPatterns(clientId: number): ClientPatterns {
  const row = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .get();
  if (!row) return {};
  try {
    return JSON.parse(row.value) as ClientPatterns;
  } catch {
    return {};
  }
}

function listLiveMessages(clientId: number): ExistingMessage[] {
  return db
    .select({
      number: messages.number,
      variant: messages.variant,
      topic: messages.topic,
      audience: messages.audience,
      status: messages.status,
    })
    .from(messages)
    .where(eq(messages.clientId, clientId))
    .all();
}

function findAudienceByKey(
  clientId: number,
  key: string,
): Audience | null {
  return (
    db
      .select()
      .from(audiences)
      .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
      .get() ?? null
  );
}

function findTopicByKey(clientId: number, key: string): Topic | null {
  return (
    db
      .select()
      .from(topics)
      .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
      .get() ?? null
  );
}

// Spec §3.3 — list reads filter out soft-deleted by default.
export function listMessages(
  clientId: number,
  opts: { includeDeleted?: boolean } = {},
): Message[] {
  if (opts.includeDeleted) {
    return db
      .select()
      .from(messages)
      .where(eq(messages.clientId, clientId))
      .orderBy(messages.number, messages.variant)
      .all();
  }
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        sql`${messages.status} IS NULL OR ${messages.status} != 'deleted'`,
      ),
    )
    .orderBy(messages.number, messages.variant)
    .all();
}

export function getMessage(clientId: number, id: number): Message | null {
  return (
    db
      .select()
      .from(messages)
      .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
      .get() ?? null
  );
}

export function createMessage(
  clientId: number,
  input: MessageInput,
): Message {
  if (!input.audience) throw new MessageError("audience is required");
  if (!input.topic) throw new MessageError("topic is required");

  const audienceRow = findAudienceByKey(clientId, input.audience);
  if (!audienceRow) {
    throw new MessageError(`audience '${input.audience}' not found`);
  }
  const topicRow = findTopicByKey(clientId, input.topic);
  if (!topicRow) {
    throw new MessageError(`topic '${input.topic}' not found`);
  }

  const slot = nextMcSlot(
    listLiveMessages(clientId),
    input.topic,
    input.audience,
  );

  const patterns = readClientPatterns(clientId);
  const pmmid = generatePmmid(
    {
      audience: input.audience,
      topic: input.topic,
      number: slot.number,
      variant: slot.variant,
      versionNo: slot.version,
    },
    [], // For PMMID we usually don't need the full audience array unless the
    [], //   pattern uses array-by-key syntax. Add when needed.
    patterns.pmmid,
  );

  const traffic = generateTrafficking(
    {
      number: slot.number,
      variant: slot.variant,
      audienceKey: input.audience,
      topicKey: input.topic,
      audience: audienceRow,
      topic: topicRow,
    },
    patterns.trafficking,
  );

  return db
    .insert(messages)
    .values({
      clientId,
      number: slot.number,
      variant: slot.variant,
      audience: input.audience,
      topic: input.topic,
      versionNo: slot.version,
      pmmid,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      template: input.template,
      templateVariantClasses: input.templateVariantClasses,
      name: input.name,
      headline: input.headline,
      copy1: input.copy1,
      copy2: input.copy2,
      image1: input.image1,
      image2: input.image2,
      image3: input.image3,
      image4: input.image4,
      image5: input.image5,
      image6: input.image6,
      video1: input.video1,
      flash: input.flash,
      flashStyle: input.flashStyle,
      cta: input.cta,
      landingUrl: input.landingUrl,
      comment: input.comment,
      brief: input.brief,
      utmCampaign: traffic.utm_campaign,
      utmSource: traffic.utm_source,
      utmMedium: traffic.utm_medium,
      utmContent: traffic.utm_content,
      utmTerm: traffic.utm_term,
      utmCd26: traffic.utm_cd26,
    })
    .returning()
    .get();
}

export function updateMessage(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: MessageInput,
): { ok: true; row: Message } | { ok: false; current: Message | null } {
  const current = getMessage(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  const updated = db
    .update(messages)
    .set({
      ...input,
      version: sql`${messages.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

// Spec §3.3 — soft delete: status='deleted', not row removal. Bumps version
// and updates timestamp.
export function softDeleteMessage(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Message } | { ok: false; current: Message | null } {
  const current = getMessage(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  const updated = db
    .update(messages)
    .set({
      status: "deleted",
      version: sql`${messages.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}
