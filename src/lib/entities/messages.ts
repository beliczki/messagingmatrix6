import { and, eq, isNull, sql } from "drizzle-orm";
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

async function findAudienceByKey(
  clientId: number,
  key: string,
): Promise<Audience | null> {
  const rows = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.key, key)))
    .limit(1);
  return rows[0] ?? null;
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
  // "new" to force a fresh number (global max + 1) even in an occupied cell.
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

  const live = await listLiveMessages(clientId);
  // A cell may hold multiple MC numbers (creative generations). Default is
  // nextMcSlot (first number's next variant); an explicit number attaches to
  // that number's variant sequence in the cell, or introduces the number when
  // it's globally free; "new" forces a fresh number.
  const slot = nextMcSlot(live, input.topic, input.audience);
  if (opts.requestedNumber === "new") {
    slot.number = nextNewNumber(live);
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
      // Claiming a number is for numbers not yet in use anywhere. Placing an
      // existing card into more audiences is copy's job (it clones the
      // fields, so audience copies can't silently diverge), and a number
      // never spans topics (findSiblings relies on it). The error names
      // which case was hit so a caller can pick the right tool.
      const liveHolder = live.find((m) => isLive(m) && m.number === n);
      if (liveHolder) {
        throw new MessageError(
          liveHolder.topic === input.topic
            ? `MC number ${n} already lives in this topic ('${input.topic}') — to place the card into more audiences use copy (it clones the fields); explicit mc_number is for numbers not yet in use`
            : `MC number ${n} is already in use in topic '${liveHolder.topic}' — a number never spans topics; pick a free number or omit it for auto-assign`,
        );
      }
      if (live.some((m) => m.number === n)) {
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
  // ({{audiences[Audience_Key].Field}}), so the full list must be in context.
  const audienceList = await listAudiences(clientId);
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

  const [row] = await db
    .insert(messages)
    .values({
      ...input,
      clientId,
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

// Two propagation tiers (user decision 2026-08-14):
// - CARD_FIELDS — creative content, styling, template: shared by every
//   audience copy of the same (number, variant). Variants are DIFFERENT
//   creatives, so these never cross a variant boundary.
// - NUMBER_LEVEL_FIELDS — lifecycle status + campaign flight dates: these are
//   campaign-level, so a global edit syncs them across ALL variants of the
//   number (every live row of the card family), not just the same variant.
// Only `audience` and `topic` stay per-copy: they define which cell the card
// lives in, so propagating them would collapse placements.
const NUMBER_LEVEL_FIELDS: WritableField[] = ["status", "startDate", "endDate"];
const CARD_FIELDS = WRITABLE_FIELDS.filter(
  (f) =>
    f !== "audience" &&
    f !== "topic" &&
    !NUMBER_LEVEL_FIELDS.includes(f),
) as WritableField[];

// Non-archived rows that are the SAME messaging card as `primary` but on a
// different audience. (number, variant) never spans more than one topic, so it
// uniquely identifies the card. Used by the editor's global-edit warning count
// and by the propagation fan-out below.
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
  return rows.filter((m) => m.id !== primary.id);
}

// Apply the shared subset of `input` to the rest of the card family. CARD_FIELDS
// go to the audience copies of the same (number, variant); NUMBER_LEVEL_FIELDS
// (status + flight dates) go to EVERY live row of the number — other variants
// included. Each row is force-updated (last-write-wins) and version-bumped so
// any editor open on it will see a conflict on its next save. audience/topic
// are dropped (per-copy placement). For same-variant copies trafficking is
// recomputed so a propagated landing_url flows into that sibling's
// UTM/Final-URL against ITS OWN audience/topic (pmmid stays the sibling's
// stable identity); other-variant rows only ever receive status/dates, which
// don't feed trafficking — their UTM fields are deliberately left untouched.
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
  ).filter((m) => m.id !== primary.id);

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

// Statuses that lock a row against placement changes. ACTIVE = measurement is
// running and the PMMID is the live measurement key (utm_content + reporting
// labels). INACTIVE / ARCHIVED = the row has been measured at some point and
// its PMMID still anchors historical reporting joins. Pre-ACTIVE statuses
// (INCOMING/NAMING/CONTENT/PREVIEW/APPROVED) and post-failure / archive-only
// statuses (ERROR/DEAD/MEMORY) stay movable: no measurement attached, PMMID
// regenerates freely.
const BLOCKED_MOVE_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"]);

// Move messages into a single target audience. Same-topic only. PMMID is
// regenerated against the new audience (it encodes audience/topic/number/
// variant/versionNo — moving without regen would make the key lie about the
// row's content). versionNo (the creative-revision counter) stays frozen — a
// move is a placement change, not a creative revision. UTM columns are also
// regenerated. Rows in BLOCKED_MOVE_STATUSES are rejected up front.
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
    if (BLOCKED_MOVE_STATUSES.has(source.status ?? "")) {
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
