import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  config,
  messages,
  nowUtc,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "@/db/schema";
import {
  isLive,
  nextMcSlot,
  nextNewNumber,
  nextVariantForNumber,
  type ExistingMessage,
} from "@/lib/numbering";
import { generatePmmid } from "@/lib/pmmid";
import {
  buildTrafficking,
  type TraffickingPatterns,
} from "@/lib/trafficking";
import { listAudiences } from "@/lib/entities/audiences";
import { listCreativesByMc } from "@/lib/entities/creatives";
import {
  channelToAudience,
  findChannelByKey,
  listChannels,
} from "@/lib/entities/channels";
import { readDefaultTemplate } from "@/lib/templates";

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

async function readClientPatterns(clientId: number): Promise<ClientPatterns> {
  const [row] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .limit(1);
  if (!row) return {};
  try {
    return JSON.parse(row.value) as ClientPatterns;
  } catch {
    return {};
  }
}

async function listLiveMessages(
  clientId: number,
): Promise<ExistingMessage[]> {
  return db
    .select({
      number: messages.number,
      variant: messages.variant,
      topic: messages.topic,
      audience: messages.audience,
      status: messages.status,
      archivedAt: messages.archivedAt,
    })
    .from(messages)
    .where(eq(messages.clientId, clientId));
}

// Resolve a placement key to an Audience. nonDCO messages store a CHANNEL key
// (e.g. "ch_disp") here — channels live in their own table now, so when the key
// isn't a real audience we fall back to the channel, presented in Audience
// shape (channelToAudience). This keeps numbering/pmmid/trafficking working for
// nonDCO rows exactly as when channels were audience rows.
async function findAudienceByKey(
  clientId: number,
  key: string,
): Promise<Audience | null> {
  const rows = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
    .limit(1);
  if (rows[0]) return rows[0];
  const channel = await findChannelByKey(clientId, key);
  return channel ? channelToAudience(channel) : null;
}

async function findTopicByKey(
  clientId: number,
  key: string,
): Promise<Topic | null> {
  const rows = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
    .limit(1);
  return rows[0] ?? null;
}

// Default list filters out archived rows. The legacy status='deleted' soft-
// delete (pre-Phase-10a) is also filtered out, since live data may still carry
// it from before the archived_at migration.
export async function listMessages(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Message[]> {
  if (opts.includeArchived) {
    // Archived rows come back, but legacy status='deleted' soft-deletes
    // (pre-Phase-10a) stay invisible here too.
    return db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          sql`(${messages.status} IS NULL OR ${messages.status} != 'deleted')`,
        ),
      )
      .orderBy(messages.number, messages.variant);
  }
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        isNull(messages.archivedAt),
        sql`(${messages.status} IS NULL OR ${messages.status} != 'deleted')`,
      ),
    )
    .orderBy(messages.number, messages.variant);
}

export async function getMessage(
  clientId: number,
  id: number,
): Promise<Message | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMessageByPmmid(
  clientId: number,
  pmmid: string,
): Promise<Message | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.pmmid, pmmid)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createMessage(
  clientId: number,
  input: MessageInput,
  // requestedNumber (MCP/HTTP mc_number): claim a specific MC number, or
  // "new" to force a fresh number (max + 1 on the target axis) even in an
  // occupied cell.
  // requestedVariant (MCP/HTTP variant): force a specific variant letter instead
  // of the auto-assigned one — the caller owns the exact (number, variant) label.
  // Both kept out of MessageInput so they can't leak into the insert spread.
  opts: { requestedNumber?: number | "new"; requestedVariant?: string } = {},
): Promise<Message> {
  if (!input.audience) throw new MessageError("audience is required");
  if (!input.topic) throw new MessageError("topic is required");

  const audienceRow = await findAudienceByKey(clientId, input.audience);
  if (!audienceRow) {
    throw new MessageError(`audience '${input.audience}' not found`);
  }
  const topicRow = await findTopicByKey(clientId, input.topic);
  if (!topicRow) {
    throw new MessageError(`topic '${input.topic}' not found`);
  }

  // Numbering is AXIS-SCOPED. DCO (audience.channel == null) and nonDCO
  // (channel set) are independent number spaces, so one MC number may pair a
  // DCO card with its static nonDCO twin in a different topic. The "a number
  // never spans topics" rule below is therefore enforced only within the
  // target audience's own axis. (audienceList is also needed by the
  // pmmid/trafficking patterns further down.) Channels are merged in as
  // Audience-shaped rows (channel = code ⇒ nonDCO) so nonDCO placements land on
  // the correct axis and resolve their {{audiences[key]...}} pattern lookups.
  const audienceList = [
    ...(await listAudiences(clientId)),
    ...(await listChannels(clientId)).map(channelToAudience),
  ];
  const channelByAudience = new Map(
    audienceList.map((a) => [a.key, a.channel ?? null]),
  );
  const targetIsDco = (audienceRow.channel ?? null) === null;
  const sameAxis = (m: { audience?: string | null }) =>
    ((channelByAudience.get(m.audience ?? "") ?? null) === null) === targetIsDco;

  const live = await listLiveMessages(clientId);
  // Allocation is axis-scoped too: a new DCO MC must not inherit a number from
  // the (much taller) nonDCO space and vice versa, so the auto-assign sees only
  // the target axis. In-cell lookups are unaffected — the target audience is on
  // the target axis by definition.
  const liveOnAxis = live.filter(sameAxis);
  // A cell may hold multiple MC numbers (creative generations). Default is
  // nextMcSlot (first number's next variant); an explicit number attaches to
  // that number's variant sequence in the cell, or introduces the number when
  // it's free on this axis; "new" forces a fresh number.
  const slot = nextMcSlot(liveOnAxis, input.topic, input.audience);
  if (opts.requestedNumber === "new") {
    slot.number = nextNewNumber(liveOnAxis);
    slot.variant = "a";
  } else if (opts.requestedNumber !== undefined) {
    const n = opts.requestedNumber;
    // Attach requires a LIVE in-cell occupant of the number — an archived
    // MC{n}a in the cell must not spawn a live twin that its restore would
    // collide with. listLiveMessages returns all rows; isLive filters here.
    const liveInCell = live.filter(
      (m) =>
        isLive(m) && m.topic === input.topic && m.audience === input.audience,
    );
    if (liveInCell.some((m) => m.number === n)) {
      slot.number = n;
      slot.variant = nextVariantForNumber(liveInCell, n);
    } else {
      // Claiming a number is for numbers not yet in use ON THIS AXIS. Placing an
      // existing card into more audiences is copy's job (it clones the
      // fields, so audience copies can't silently diverge), and a number
      // never spans topics WITHIN an axis (findSiblings is axis-scoped for
      // exactly this reason — see sameAxisAs). Cross-axis
      // reuse is allowed — a DCO number may be claimed for its nonDCO twin.
      const liveHolder = live.find(
        (m) => isLive(m) && m.number === n && sameAxis(m),
      );
      if (liveHolder) {
        throw new MessageError(
          liveHolder.topic === input.topic
            ? `MC number ${n} already lives in this topic ('${input.topic}') — to place the card into more audiences use copy (it clones the fields); explicit mc_number is for numbers not yet in use`
            : `MC number ${n} is already in use in topic '${liveHolder.topic}' — a number never spans topics; pick a free number or omit it for auto-assign`,
        );
      }
      if (live.some((m) => m.number === n && sameAxis(m))) {
        throw new MessageError(
          `MC number ${n} is retired — archived rows still hold it; restore the archived card instead, or pick a free number`,
        );
      }
      slot.number = n;
      slot.variant = "a";
    }
  }

  // Explicit variant override: the caller pins the exact letter (e.g. 317b even
  // when no 317a exists). Number allocation above is unchanged; we only replace
  // the letter, then guard against colliding with a live twin in the same cell.
  if (opts.requestedVariant !== undefined) {
    const v = opts.requestedVariant;
    if (!/^[a-z]$/.test(v)) {
      throw new MessageError(
        `variant '${v}' is invalid — must be a single lowercase letter a–z`,
      );
    }
    const collision = live.some(
      (m) =>
        isLive(m) &&
        m.topic === input.topic &&
        m.audience === input.audience &&
        m.number === slot.number &&
        m.variant === v,
    );
    if (collision) {
      throw new MessageError(
        `MC ${slot.number}${v} already exists in this cell — pick a free variant`,
      );
    }
    slot.variant = v;
  }

  // Explicit claims must not create a live twin of a dormant (archived /
  // legacy-deleted) same-cell row — the twin would carry the identical PMMID
  // and a later restore would resurrect a duplicate. Live collisions are
  // handled above; the auto-assign path keeps its v5 semantics.
  if (opts.requestedNumber !== undefined || opts.requestedVariant !== undefined) {
    const dormantTwin = live.find(
      (m) =>
        !isLive(m) &&
        m.topic === input.topic &&
        m.audience === input.audience &&
        m.number === slot.number &&
        (m.variant ?? "") === slot.variant,
    );
    if (dormantTwin) {
      throw new MessageError(
        `MC${slot.number}${slot.variant} exists archived in this cell — restore it instead, or pick another variant`,
      );
    }
  }

  const patterns = await readClientPatterns(clientId);
  // The Erste pmmid/trafficking patterns look the audience up by key
  // ({{audiences[Audience_Key].Field}}) — audienceList is resolved above.
  const pmmid = generatePmmid(
    {
      audience: input.audience,
      topic: input.topic,
      number: slot.number,
      variant: slot.variant,
      versionNo: slot.version,
    },
    audienceList,
    [],
    patterns.pmmid,
  );

  const traffic = buildTrafficking(
    {
      number: slot.number,
      variant: slot.variant,
      audience: input.audience,
      topic: input.topic,
      landingUrl: input.landingUrl,
    },
    audienceRow,
    topicRow,
    patterns,
    audienceList,
    pmmid,
  );

  // New DCO MCs inherit the client's default template when the caller passes
  // none; nonDCO (channel) placements stay image-based (template null).
  const template =
    input.template != null
      ? input.template
      : targetIsDco
        ? await readDefaultTemplate(clientId)
        : null;

  const [row] = await db
    .insert(messages)
    .values({
      ...input,
      clientId,
      // New MCs start life in INCOMING unless the caller passes a status —
      // covers the matrix create dialog, MCP mc_create/mc_create_batch, and
      // creative/draft promotion. copy/move clone the source status via their
      // own insert paths, so they are unaffected.
      status: input.status ?? "INCOMING",
      template,
      number: slot.number,
      variant: slot.variant,
      audience: input.audience,
      topic: input.topic,
      versionNo: slot.version,
      pmmid,
      utmCampaign: traffic.utm_campaign,
      utmSource: traffic.utm_source,
      utmMedium: traffic.utm_medium,
      utmContent: traffic.utm_content,
      utmTerm: traffic.utm_term,
      utmCd26: traffic.utm_cd26,
      finalTraffickedUrl: traffic.final_trafficked_url,
    })
    .returning();
  return row;
}

export async function updateMessage(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: MessageInput,
): Promise<{ ok: true; row: Message } | { ok: false; current: Message | null }> {
  const current = await getMessage(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  // Trafficking is "generated on every save" (Trafficking tab). Recompute the
  // UTM fields + final URL from the post-edit values so e.g. a landing_url edit
  // flows through. PMMID is left as-is — it is the message's stable identity and
  // is only (re)generated on create/copy/move.
  const merged = { ...current, ...input };
  const patterns = await readClientPatterns(clientId);
  const traffic = buildTrafficking(
    {
      number: merged.number,
      variant: merged.variant,
      audience: merged.audience,
      topic: merged.topic,
      landingUrl: merged.landingUrl,
    },
    await findAudienceByKey(clientId, merged.audience),
    await findTopicByKey(clientId, merged.topic),
    patterns,
    await listAudiences(clientId),
    current.pmmid,
  );
  const [updated] = await db
    .update(messages)
    .set({
      ...input,
      utmCampaign: traffic.utm_campaign,
      utmSource: traffic.utm_source,
      utmMedium: traffic.utm_medium,
      utmContent: traffic.utm_content,
      utmTerm: traffic.utm_term,
      utmCd26: traffic.utm_cd26,
      finalTraffickedUrl: traffic.final_trafficked_url,
      version: sql`${messages.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Single propagation tier (user decision 2026-08-17, superseding the
// 2026-08-14 two-tier split): every shared field — creative content, styling,
// template, AND lifecycle status + campaign flight dates — is variant-level.
// A global edit syncs them across the audience copies of the SAME
// (number, variant) only; variants are DIFFERENT creatives with their own
// lifecycle, so a status/date change on 331c never crosses into 331a/331b.
// Only `audience` and `topic` stay per-copy: they define which cell the card
// lives in, so propagating them would collapse placements.
// NUMBER_LEVEL_FIELDS is now empty — kept as the config seam so a field can be
// promoted back to number-level without touching the fan-out logic below.
const NUMBER_LEVEL_FIELDS: WritableField[] = [];
const CARD_FIELDS = WRITABLE_FIELDS.filter(
  (f) =>
    f !== "audience" &&
    f !== "topic" &&
    !NUMBER_LEVEL_FIELDS.includes(f),
) as WritableField[];

// Axis membership test for the card family below. Numbering is axis-scoped
// (see nextMcSlot): a DCO number may be claimed for its static nonDCO twin, so
// (number, variant) alone can name TWO different cards — the DCO one and its
// nonDCO namesake in another topic. The family is therefore (number, variant)
// WITHIN one axis. Channels are merged in as Audience-shaped rows so a nonDCO
// row's `ch_*` audience key resolves to a channel (⇒ nonDCO); a key that
// resolves to nothing counts as DCO, matching nextMcSlot's `sameAxis`.
async function sameAxisAs(
  clientId: number,
  primary: Message,
): Promise<(m: { audience: string }) => boolean> {
  const audienceList = [
    ...(await listAudiences(clientId)),
    ...(await listChannels(clientId)).map(channelToAudience),
  ];
  const channelByAudience = new Map(
    audienceList.map((a) => [a.key, a.channel ?? null]),
  );
  const isDco = (m: { audience: string }) =>
    (channelByAudience.get(m.audience) ?? null) === null;
  const primaryIsDco = isDco(primary);
  return (m) => isDco(m) === primaryIsDco;
}

// Non-archived rows that are the SAME messaging card as `primary` but on a
// different audience. Within one axis, (number, variant) never spans more than
// one topic, so it uniquely identifies the card. Used by the editor's
// global-edit warning count and by the propagation fan-out below.
export async function findSiblings(
  clientId: number,
  primary: Message,
): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, primary.number),
        eq(messages.variant, primary.variant),
        isNull(messages.archivedAt),
      ),
    );
  const onAxis = await sameAxisAs(clientId, primary);
  return rows.filter((m) => m.id !== primary.id && onAxis(m));
}

// Apply the shared subset of `input` to the rest of the card family. Every
// shared field (creative, status, flight dates) goes to the audience copies of
// the same (number, variant) ON THE SAME AXIS — a DCO card and its static
// nonDCO namesake share a number but are different cards, so a global edit on
// one must never reach the other. Other variants of the number are untouched.
// Each row is force-updated (last-write-wins) and version-bumped so any editor
// open on it will see a conflict on its next save. audience/topic are dropped
// (per-copy placement). Trafficking is recomputed for each copy so a propagated
// landing_url flows into that sibling's UTM/Final-URL against ITS OWN
// audience/topic (pmmid stays the sibling's stable identity).
// Returns { before, after } pairs so the caller can write per-row audit
// entries (revision history).
export async function propagateToSiblings(
  clientId: number,
  primary: Message,
  input: MessageInput,
): Promise<Array<{ before: Message; after: Message }>> {
  const cardPayload: Record<string, unknown> = {};
  for (const f of CARD_FIELDS) {
    if (f in input) cardPayload[f] = (input as Record<string, unknown>)[f];
  }
  const numberPayload: Record<string, unknown> = {};
  for (const f of NUMBER_LEVEL_FIELDS) {
    if (f in input) numberPayload[f] = (input as Record<string, unknown>)[f];
  }
  if (
    Object.keys(cardPayload).length === 0 &&
    Object.keys(numberPayload).length === 0
  ) {
    return [];
  }

  const patterns = await readClientPatterns(clientId);
  const audienceList = await listAudiences(clientId);
  const onAxis = await sameAxisAs(clientId, primary);
  const family = (
    await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.number, primary.number),
          isNull(messages.archivedAt),
        ),
      )
  ).filter((m) => m.id !== primary.id && onAxis(m));

  const changes: Array<{ before: Message; after: Message }> = [];
  for (const sib of family) {
    const sameVariant = sib.variant === primary.variant;
    const payload = sameVariant
      ? { ...numberPayload, ...cardPayload }
      : { ...numberPayload };
    if (Object.keys(payload).length === 0) continue;

    let trafficFields: Record<string, unknown> = {};
    if (sameVariant) {
      const merged = { ...sib, ...payload } as Message;
      const traffic = buildTrafficking(
        {
          number: merged.number,
          variant: merged.variant,
          audience: merged.audience,
          topic: merged.topic,
          landingUrl: merged.landingUrl,
        },
        await findAudienceByKey(clientId, merged.audience),
        await findTopicByKey(clientId, merged.topic),
        patterns,
        audienceList,
        sib.pmmid,
      );
      trafficFields = {
        utmCampaign: traffic.utm_campaign,
        utmSource: traffic.utm_source,
        utmMedium: traffic.utm_medium,
        utmContent: traffic.utm_content,
        utmTerm: traffic.utm_term,
        utmCd26: traffic.utm_cd26,
        finalTraffickedUrl: traffic.final_trafficked_url,
      };
    }
    const [after] = await db
      .update(messages)
      .set({
        ...payload,
        ...trafficFields,
        version: sql`${messages.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(messages.clientId, clientId), eq(messages.id, sib.id)))
      .returning();
    changes.push({ before: sib, after });
  }
  return changes;
}

export async function archiveMessage(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<{ ok: true; row: Message } | { ok: false; current: Message | null }> {
  const current = await getMessage(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  const [updated] = await db
    .update(messages)
    .set({
      archivedAt: nowUtc,
      version: sql`${messages.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning();
  return { ok: true, row: updated };
}

// Restore a message. Parent-first guard: if either the audience or the topic
// the message points at is currently archived, the restore is rejected.
// Caller (HTTP/MCP) should map `parent_archived` to a 409.
export async function restoreMessage(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  | { ok: true; row: Message }
  | {
      ok: false;
      current: Message | null;
      reason?: "parent_archived";
      parent?: { type: "audience" | "topic"; key: string };
    }
> {
  const current = await getMessage(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };

  const audienceRow = await findAudienceByKey(clientId, current.audience);
  if (audienceRow && audienceRow.archivedAt !== null) {
    return {
      ok: false,
      current,
      reason: "parent_archived",
      parent: { type: "audience", key: current.audience },
    };
  }
  const topicRow = await findTopicByKey(clientId, current.topic);
  if (topicRow && topicRow.archivedAt !== null) {
    return {
      ok: false,
      current,
      reason: "parent_archived",
      parent: { type: "topic", key: current.topic },
    };
  }

  const [updated] = await db
    .update(messages)
    .set({
      archivedAt: null,
      version: sql`${messages.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning();
  return { ok: true, row: updated };
}

export type CopyOpts = { fieldOverrides?: MessageInput };

// Copy each source MC into each target audience (under the source's topic).
// Returns `created` in the same order iterated: outer = source, inner = target
// audience. Mirrors moveMessages placement rules so copy and move agree:
// preserve the source's (number, variant) in the target cell when free; bump
// variant via nextMcSlot only on collision. PMMID + UTM are regenerated per
// target audience (PMMID encodes audience+topic+number+variant+versionNo, so
// it can't be cloned verbatim). versionNo resets to 1 — a copy is a new MC,
// not a creative revision of the source.
export async function copyMessages(
  clientId: number,
  sourceMcLabels: string[],
  targetAudienceKeys: string[],
  opts: CopyOpts = {},
): Promise<{ created: Message[] }> {
  // Resolve all sources up front so a bad label fails before any insert.
  const sources: Message[] = [];
  for (const label of sourceMcLabels) {
    const source = await getMessageByPmmid(clientId, label);
    if (!source) {
      throw new MessageError(`message '${label}' not found`);
    }
    sources.push(source);
  }

  // Resolve every target audience once.
  const targetAudienceRows = new Map<string, Audience>();
  for (const key of targetAudienceKeys) {
    const row = await findAudienceByKey(clientId, key);
    if (!row) {
      throw new MessageError(`audience '${key}' not found`);
    }
    targetAudienceRows.set(key, row);
  }

  // Topic rows cached by key — every target inherits source.topic.
  const topicRows = new Map<string, Topic | null>();
  const topicFor = async (key: string): Promise<Topic> => {
    if (!topicRows.has(key)) {
      const row = await findTopicByKey(clientId, key);
      if (!row) throw new MessageError(`topic '${key}' not found`);
      topicRows.set(key, row);
    }
    return topicRows.get(key) as Topic;
  };

  const patterns = await readClientPatterns(clientId);
  const liveAll = await listLiveMessages(clientId);
  // Full audience list for by-key pmmid/trafficking patterns
  // ({{audiences[Audience_Key].Field}}).
  const audienceList = await listAudiences(clientId);

  // Plan-pass: build the placement for every (source × target audience) pair.
  // Planned rows count as occupants of their target cell so a batch copying
  // X a/b/c into one empty cell lays them out as X a/b/c (without it, all
  // three would collide on X a).
  type Plan = {
    source: Message;
    targetAud: string;
    number: number;
    variant: string;
  };
  const plan: Plan[] = [];
  for (const source of sources) {
    for (const targetAud of targetAudienceKeys) {
      const topic = source.topic;
      const cellOccupants: ExistingMessage[] = [
        ...liveAll.filter(
          (m) => m.topic === topic && m.audience === targetAud,
        ),
        ...plan
          .filter((p) => p.source.topic === topic && p.targetAud === targetAud)
          .map((p) => ({
            number: p.number,
            variant: p.variant,
            topic,
            audience: targetAud,
            status: null,
            archivedAt: null,
          })),
      ];
      const taken = cellOccupants.some(
        (m) =>
          m.number === source.number && (m.variant ?? "") === source.variant,
      );
      let number: number;
      let variant: string;
      if (!taken) {
        number = source.number;
        variant = source.variant;
      } else {
        // Collision: keep the source's number (a copy never changes card
        // identity) and bump the variant among that number's occupants only —
        // a mixed cell's other numbers must not renumber or advance it.
        number = source.number;
        variant = nextVariantForNumber(cellOccupants, source.number);
      }
      plan.push({ source, targetAud, number, variant });
    }
  }

  // Apply inserts in plan order.
  const created: Message[] = [];
  for (const p of plan) {
    const cloneable: MessageInput = pickWritable(p.source);
    const overrides: MessageInput = opts.fieldOverrides ?? {};
    const audienceRow = targetAudienceRows.get(p.targetAud) as Audience;
    const topicRow = await topicFor(p.source.topic);

    const pmmid = generatePmmid(
      {
        audience: p.targetAud,
        topic: p.source.topic,
        number: p.number,
        variant: p.variant,
        versionNo: 1,
      },
      audienceList,
      [],
      patterns.pmmid,
    );
    const traffic = buildTrafficking(
      {
        number: p.number,
        variant: p.variant,
        audience: p.targetAud,
        topic: p.source.topic,
        landingUrl: { ...cloneable, ...overrides }.landingUrl,
      },
      audienceRow,
      topicRow,
      patterns,
      audienceList,
      pmmid,
    );

    const [row] = await db
      .insert(messages)
      .values({
        ...cloneable,
        ...overrides,
        clientId,
        audience: p.targetAud,
        topic: p.source.topic,
        number: p.number,
        variant: p.variant,
        versionNo: 1,
        pmmid,
        utmCampaign: traffic.utm_campaign,
        utmSource: traffic.utm_source,
        utmMedium: traffic.utm_medium,
        utmContent: traffic.utm_content,
        utmTerm: traffic.utm_term,
        utmCd26: traffic.utm_cd26,
        finalTraffickedUrl: traffic.final_trafficked_url,
      })
      .returning();
    created.push(row);
  }
  return { created };
}

export type MoveItem = { mcLabel: string; expectedVersion: number };
export type MoveResult =
  | { ok: true; updated: Message[] }
  | {
      ok: false;
      reason:
        | "version_conflict"
        | "not_found"
        | "cross_topic_move_not_supported"
        | "target_audience_not_found"
        | "row_locked_by_status";
      mcLabel: string;
      current?: Message;
      status?: string;
    };

// Statuses that lock a row against placement changes and against hard delete.
// ACTIVE = measurement is running and the PMMID is the live measurement key
// (utm_content + reporting labels). INACTIVE / ARCHIVED = the row has been
// measured at some point and its PMMID still anchors historical reporting
// joins. Pre-ACTIVE statuses (INCOMING/NAMING/CONTENT/PREVIEW/APPROVED) and
// post-failure / archive-only statuses (ERROR/DEAD/MEMORY) stay movable and
// purgeable: no measurement attached, PMMID regenerates freely.
const MEASUREMENT_LOCKED_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"]);

// Move messages into a single target audience. Same-topic only. PMMID is
// regenerated against the new audience (it encodes audience/topic/number/
// variant/versionNo — moving without regen would make the key lie about the
// row's content). versionNo (the creative-revision counter) stays frozen — a
// move is a placement change, not a creative revision. UTM columns are also
// regenerated. Rows in MEASUREMENT_LOCKED_STATUSES are rejected up front.
// On (number, variant) collision in the target cell, variant auto-bumps to the
// next free char so moves always succeed without renumbering existing rows.
export async function moveMessages(
  clientId: number,
  moves: MoveItem[],
  targetAudienceKey: string,
): Promise<MoveResult> {
  const targetAudience = await findAudienceByKey(clientId, targetAudienceKey);
  if (!targetAudience) {
    return {
      ok: false,
      reason: "target_audience_not_found",
      mcLabel: moves[0]?.mcLabel ?? "",
    };
  }

  const patterns = await readClientPatterns(clientId);
  // Full audience list for by-key pmmid/trafficking patterns
  // ({{audiences[Audience_Key].Field}}).
  const audienceList = await listAudiences(clientId);

  // Pre-pass: resolve all sources + validate same-topic + optimistic version.
  type Resolved = {
    item: MoveItem;
    source: Message;
    topicRow: Topic | null;
  };
  const resolved: Resolved[] = [];
  for (const m of moves) {
    const source = await getMessageByPmmid(clientId, m.mcLabel);
    if (!source) {
      return { ok: false, reason: "not_found", mcLabel: m.mcLabel };
    }
    if (source.version !== m.expectedVersion) {
      return {
        ok: false,
        reason: "version_conflict",
        mcLabel: m.mcLabel,
        current: source,
      };
    }
    if (MEASUREMENT_LOCKED_STATUSES.has(source.status ?? "")) {
      return {
        ok: false,
        reason: "row_locked_by_status",
        mcLabel: m.mcLabel,
        status: source.status ?? "",
        current: source,
      };
    }
    const topicRow = await findTopicByKey(clientId, source.topic);
    resolved.push({ item: m, source, topicRow });
  }

  // All resolved sources must share their topic with the planning group's
  // existing target cell occupants (single-topic invariant).
  const distinctTopics = new Set(resolved.map((r) => r.source.topic));
  if (distinctTopics.size > 1) {
    return {
      ok: false,
      reason: "cross_topic_move_not_supported",
      mcLabel: resolved[0]?.item.mcLabel ?? "",
    };
  }

  // Per-row (number, variant) plan against the live snapshot of the target
  // cell. We start from the live messages and append our own plan as we go,
  // so a batch moving multiple MCs into the same cell doesn't collide with
  // itself.
  const liveAll = await listLiveMessages(clientId);
  type Plan = Resolved & { number: number; variant: string };
  const plan: Plan[] = [];

  for (const r of resolved) {
    const topic = r.source.topic;
    const moverIds = new Set(plan.map((p) => p.source.id));
    moverIds.add(r.source.id); // ignore the source row itself for collision
    const cellOccupants: ExistingMessage[] = [
      ...liveAll.filter(
        (m) =>
          m.topic === topic &&
          m.audience === targetAudienceKey &&
          !moverIds.has((m as Message).id),
      ),
      ...plan
        .filter((p) => p.source.topic === topic)
        .map((p) => ({
          number: p.number,
          variant: p.variant,
          topic,
          audience: targetAudienceKey,
          status: null,
          archivedAt: null,
        })),
    ];

    // Is (source.number, source.variant) free in the target cell?
    const taken = cellOccupants.some(
      (m) =>
        m.number === r.source.number && (m.variant ?? "") === r.source.variant,
    );

    let number: number;
    let variant: string;
    if (!taken) {
      number = r.source.number;
      variant = r.source.variant;
    } else {
      // Collision: keep the mover's number (a move is a placement change,
      // never a renumbering) and bump the variant among that number's
      // occupants only — mixed-cell numbers must not capture the mover.
      number = r.source.number;
      variant = nextVariantForNumber(cellOccupants, r.source.number);
    }

    plan.push({ ...r, number, variant });
  }

  // Apply updates.
  const updated: Message[] = [];
  for (const p of plan) {
    // PMMID first — utm_cd26 = {{PMMID}} reads the regenerated id.
    const newPmmid = generatePmmid(
      {
        audience: targetAudienceKey,
        topic: p.source.topic,
        number: p.number,
        variant: p.variant,
        versionNo: p.source.versionNo,
      },
      audienceList,
      [],
      patterns.pmmid,
    );
    const traffic = buildTrafficking(
      {
        number: p.number,
        variant: p.variant,
        audience: targetAudienceKey,
        topic: p.source.topic,
        landingUrl: p.source.landingUrl,
      },
      targetAudience,
      p.topicRow,
      patterns,
      audienceList,
      newPmmid,
    );
    const [row] = await db
      .update(messages)
      .set({
        audience: targetAudienceKey,
        number: p.number,
        variant: p.variant,
        pmmid: newPmmid,
        utmCampaign: traffic.utm_campaign,
        utmSource: traffic.utm_source,
        utmMedium: traffic.utm_medium,
        utmContent: traffic.utm_content,
        utmTerm: traffic.utm_term,
        utmCd26: traffic.utm_cd26,
        finalTraffickedUrl: traffic.final_trafficked_url,
        version: sql`${messages.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(messages.clientId, clientId), eq(messages.id, p.source.id)))
      .returning();
    updated.push(row);
  }
  return { ok: true, updated };
}

export type RemoveItem = { mcLabel: string; expectedVersion: number };
export type RemoveResult =
  | { ok: true; rows: Message[] }
  | {
      ok: false;
      reason:
        | "version_conflict"
        | "not_found"
        | "row_locked_by_status"
        | "creative_linked";
      mcLabel: string;
      current?: Message;
      status?: string;
      creativeCount?: number;
    };

// Shared pre-pass for the two bulk removals: resolve every mc_label and enforce
// the optimistic version. All-or-nothing — the first bad item aborts the batch
// before anything is written (callers wrap the whole op in a transaction).
async function resolveRemovals(
  clientId: number,
  items: RemoveItem[],
): Promise<
  { ok: true; rows: Message[] } | Extract<RemoveResult, { ok: false }>
> {
  const rows: Message[] = [];
  for (const item of items) {
    const row = await getMessageByPmmid(clientId, item.mcLabel);
    if (!row) {
      return { ok: false, reason: "not_found", mcLabel: item.mcLabel };
    }
    if (row.version !== item.expectedVersion) {
      return {
        ok: false,
        reason: "version_conflict",
        mcLabel: item.mcLabel,
        current: row,
      };
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

// Soft-delete a batch: same per-row semantics as archiveMessage (archived_at +
// version bump), restorable from the grid's "Show archived". No status guard —
// archiving a measured row is exactly how a live card is retired.
export async function archiveMessages(
  clientId: number,
  items: RemoveItem[],
): Promise<RemoveResult> {
  const resolved = await resolveRemovals(clientId, items);
  if (!resolved.ok) return resolved;

  const archived: Message[] = [];
  for (const row of resolved.rows) {
    const [updated] = await db
      .update(messages)
      .set({
        archivedAt: nowUtc,
        version: sql`${messages.version} + 1`,
        updatedAt: nowUtc,
      })
      .where(and(eq(messages.clientId, clientId), eq(messages.id, row.id)))
      .returning();
    archived.push(updated);
  }
  return { ok: true, rows: archived };
}

// Hard-delete a batch — the row is gone, only the audit entry survives. Two
// guards, both naming their case to the caller:
//   * MEASUREMENT_LOCKED_STATUSES → archive is the only way out of a measured
//     row (its PMMID still anchors reporting joins).
//   * creative back-links → creatives.mc_number/mc_variant is a plain column
//     pair, not an FK. Deleting the last row carrying a (number, variant) would
//     leave those creatives claiming an MC that no longer exists, and
//     promoteCreative refuses to re-promote an already-matrixed creative.
// Rows referenced by an FK (message_previews, monitoring, draft_messages) are
// handled by the schema's cascade / set-null.
export async function deleteMessages(
  clientId: number,
  items: RemoveItem[],
): Promise<RemoveResult> {
  const resolved = await resolveRemovals(clientId, items);
  if (!resolved.ok) return resolved;
  const rows = resolved.rows;

  for (const row of rows) {
    if (MEASUREMENT_LOCKED_STATUSES.has(row.status ?? "")) {
      return {
        ok: false,
        reason: "row_locked_by_status",
        mcLabel: row.pmmid ?? "",
        status: row.status ?? "",
        current: row,
      };
    }
  }

  // A (number, variant) only loses its creative back-links when NO row carries
  // it any more — an archived twin still holds the pair and can be restored.
  const deletingIds = new Set(rows.map((r) => r.id));
  const checkedPairs = new Set<string>();
  for (const row of rows) {
    const pair = `${row.number}${row.variant}`;
    if (checkedPairs.has(pair)) continue;
    checkedPairs.add(pair);

    const carriers = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.clientId, clientId),
          eq(messages.number, row.number),
          eq(messages.variant, row.variant),
        ),
      );
    if (carriers.some((c) => !deletingIds.has(c.id))) continue;

    const linked = await listCreativesByMc(clientId, row.number, row.variant);
    if (linked.length > 0) {
      return {
        ok: false,
        reason: "creative_linked",
        mcLabel: row.pmmid ?? "",
        creativeCount: linked.length,
        current: row,
      };
    }
  }

  await db
    .delete(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        inArray(messages.id, [...deletingIds]),
      ),
    );
  return { ok: true, rows };
}
