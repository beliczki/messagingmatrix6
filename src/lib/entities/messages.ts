import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
import { type TraffickingPatterns } from "@/lib/trafficking";
import {
  regeneratedIdentity,
  traffickingColumns,
} from "@/lib/message-identity";
import { listAudiences } from "@/lib/entities/audiences";
import { listCreativesByMc } from "@/lib/entities/creatives";
import {
  channelToAudience,
  findChannelByKey,
  listChannels,
} from "@/lib/entities/channels";
import { readDefaultTemplate } from "@/lib/templates";
import { BIRTH_STATUS, isMeasurementLocked } from "@/lib/mc-status";

// A row that occupies a cell. DRAFT rows are the only audience-less ones (DB
// check `messages_draft_has_no_audience`) and a placed row always carries a
// topic (`messages_placed_has_topic`), so this narrowing is the type-level
// spelling of "not a draft" — and everything that reads the grid (numbering
// axes, pmmid/trafficking, feed, export, siblings) needs it, because those are
// all keyed on the cell a draft does not have.
export type PlacedMessage = Message & { audience: string; topic: string };

export function isPlaced(m: Message): m is PlacedMessage {
  return m.audience !== null && m.topic !== null;
}

// Every query that means "the matrix" must say so, or drafts leak into it. One
// named predicate rather than a bare isNotNull repeated at each call site: a
// query that forgets the boundary then reads as a MISSING call, not as normal
// code that happens to be wrong.
const PLACED_ONLY = isNotNull(messages.audience);

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
  "briefSlidesFileId",
  "briefSlideId",
  "draftProduct",
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

export async function readClientPatterns(
  clientId: number,
): Promise<ClientPatterns> {
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

// Resolve a placement key to an Audience. Agentic messages store a CHANNEL key
// (e.g. "ch_disp") here — channels live in their own table now, so when the key
// isn't a real audience we fall back to the channel, presented in Audience
// shape (channelToAudience). This keeps numbering/pmmid/trafficking working for
// Agentic rows exactly as when channels were audience rows.
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

// listMessages minus the drafts — what every matrix-facing consumer (exports,
// dashboards, feeds) actually means by "the messages", since all of them key on
// the cell. Kept next to listMessages so the choice is made at the call site,
// rather than by remembering to add a .filter() somewhere downstream.
export async function listPlacedMessages(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<PlacedMessage[]> {
  return (await listMessages(clientId, opts)).filter(isPlaced);
}

// The drafts surface: work taken on but not yet placed. Newest first — a drafts
// list is a worklist, not a catalogue, so the thing you just took on belongs at
// the top; the matrix orders by number because there it IS a catalogue.
export async function listDrafts(
  clientId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Message[]> {
  const conds = [eq(messages.clientId, clientId), eq(messages.status, "DRAFT")];
  if (!opts.includeArchived) conds.push(isNull(messages.archivedAt));
  return db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(desc(messages.createdAt), desc(messages.id));
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

  // Numbering is AXIS-SCOPED. DCO (audience.channel == null) and Agentic
  // (channel set) are independent number spaces, so one MC number may pair a
  // DCO card with its static Agentic twin in a different topic. The "a number
  // never spans topics" rule below is therefore enforced only within the
  // target audience's own axis. (audienceList is also needed by the
  // pmmid/trafficking patterns further down.) Channels are merged in as
  // Audience-shaped rows (channel = code ⇒ Agentic) so Agentic placements land on
  // the correct axis and resolve their {{audiences[key]...}} pattern lookups.
  const audienceList = [
    ...(await listAudiences(clientId)),
    ...(await listChannels(clientId)).map(channelToAudience),
  ];
  const channelByAudience = new Map(
    audienceList.map((a) => [a.key, a.channel ?? null]),
  );
  const targetIsDco = (audienceRow.channel ?? null) === null;
  // A DRAFT has no audience and therefore no axis — but its NUMBER is claimed,
  // which is the whole point of claiming one at intake. So a draft counts as
  // occupying its number on EVERY axis: it must be unavailable to both, or the
  // number would move under the draft between intake and promotion. Without
  // this it falls through the lookup below to `null`, is mistaken for a DCO row,
  // and an Agentic create is free to take the number the draft is holding.
  const sameAxis = (m: { audience?: string | null }) =>
    (m.audience ?? null) === null ||
    ((channelByAudience.get(m.audience ?? "") ?? null) === null) === targetIsDco;

  const live = await listLiveMessages(clientId);
  // Allocation is axis-scoped too: a new DCO MC must not inherit a number from
  // the (much taller) Agentic space and vice versa, so the auto-assign sees only
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
      // reuse is allowed — a DCO number may be claimed for its Agentic twin.
      const liveHolder = live.find(
        (m) => isLive(m) && m.number === n && sameAxis(m),
      );
      if (liveHolder && (liveHolder.audience ?? null) === null) {
        throw new MessageError(
          `MC number ${n} is reserved by a draft — open it in Drafts and promote it into this cell, or pick a free number`,
        );
      }
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
  const identity = regeneratedIdentity(
    {
      audience: input.audience,
      topic: input.topic,
      number: slot.number,
      variant: slot.variant,
      versionNo: slot.version,
      landingUrl: input.landingUrl,
    },
    { audienceRow, topicRow, patterns, audienceList },
  );

  // New DCO MCs inherit the client's default template when the caller passes
  // none; Agentic (channel) placements stay image-based (template null).
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
      // New MCs start life in PREVIEW unless the caller passes a status. By the
      // time an MC is placed in the matrix it has its template and its content,
      // so the earlier statuses only ever described a moment that had already
      // passed — the operator flipped every new card to PREVIEW by hand, which
      // is why INCOMING carried 4 rows while nothing sat in NAMING at all.
      // Covers the matrix create dialog and MCP mc_create/mc_create_batch;
      // copy/move clone the source status through their own insert paths.
      status: input.status ?? BIRTH_STATUS,
      template,
      number: slot.number,
      variant: slot.variant,
      audience: input.audience,
      topic: input.topic,
      versionNo: slot.version,
      ...identity,
    })
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// DRAFT lifecycle. A draft is a `messages` row with no audience, so createDraft
// is the only place one is born and promoteDraft the only place one becomes a
// matrix card. Both go through the same numbering machinery as createMessage —
// that reuse is the reason a draft is a message row in the first place.
// ---------------------------------------------------------------------------

// Take work on now, decide where it goes later: the MC number is claimed at
// intake and never moves again.
//
// The number is allocated GLOBALLY — max over every live row on BOTH axes plus
// the drafts already holding numbers — not per axis. Per-axis would mean the
// number has to be re-checked at promotion, when the axis is finally known, and
// could move then; that is exactly the uncertainty the claim exists to end.
// Spending a number out of the shared ceiling is the cheap side of that trade.
// A deliberate DCO/Agentic twin still goes the explicit way, via createMessage's
// requestedNumber, which is unchanged.
export async function createDraft(
  clientId: number,
  input: MessageInput = {},
  opts: { requestedVariant?: string } = {},
): Promise<Message> {
  if (input.audience) {
    throw new MessageError(
      "a draft has no audience — that is what keeps it out of the matrix; use promote to place it",
    );
  }
  if (input.status && input.status !== "DRAFT") {
    throw new MessageError(
      `a draft's status is DRAFT, not '${input.status}' — use promote to move it on`,
    );
  }
  const variant = opts.requestedVariant ?? "a";
  if (!/^[a-z]$/.test(variant)) {
    throw new MessageError(
      `variant '${variant}' is invalid — must be a single lowercase letter a–z`,
    );
  }

  const live = await listLiveMessages(clientId);
  const [row] = await db
    .insert(messages)
    .values({
      ...input,
      clientId,
      status: "DRAFT",
      audience: null,
      // Free text at this stage: a working title the user can edit. Promotion
      // is what forces it to resolve to a real topics row.
      topic: input.topic ?? null,
      number: nextNewNumber(live),
      variant,
      versionNo: 1,
      // No PMMID until the row has a cell to name (check
      // `messages_draft_has_no_pmmid`).
      pmmid: null,
      template:
        input.template != null
          ? input.template
          : await readDefaultTemplate(clientId),
    })
    .returning();
  return row;
}

// Place a draft into a cell. The row is UPDATED, not re-created: the draft and
// the card it becomes are the same MC, and keeping one row is what lets the
// number, the brief link and the edit history survive the transition.
//
// The number is carried over untouched — that is the promise made at intake.
// Only the variant may shift, and only when the target cell already holds this
// number, in which case it takes the next free letter in that number's sequence.
export async function promoteDraft(
  clientId: number,
  id: number,
  opts: {
    audienceKey: string;
    topicKey: string;
    expectedVersion?: number;
    status?: string;
  },
): Promise<Message> {
  const draft = await getMessage(clientId, id);
  if (!draft) throw new MessageError(`message ${id} not found`);
  if (draft.status !== "DRAFT") {
    throw new MessageError(
      `message ${id} is not a draft (status '${draft.status}') — it is already in the matrix`,
    );
  }
  if (
    opts.expectedVersion !== undefined &&
    draft.version !== opts.expectedVersion
  ) {
    throw new MessageError(
      `draft ${id} changed since you loaded it — reload and promote again`,
    );
  }

  const audienceRow = await findAudienceByKey(clientId, opts.audienceKey);
  if (!audienceRow) {
    throw new MessageError(`audience '${opts.audienceKey}' not found`);
  }
  // The draft's own topic is a suggested NAME and may not name anything; the
  // promote is where it has to become a real key. Refusing here (rather than
  // creating the topic) keeps the topics dimension curated — a promote that
  // silently minted topics would fill it with near-duplicate spellings.
  const topicRow = await findTopicByKey(clientId, opts.topicKey);
  if (!topicRow) {
    throw new MessageError(
      `topic '${opts.topicKey}' not found — create the topic first, then promote`,
    );
  }

  const live = await listLiveMessages(clientId);
  const liveInCell = live.filter(
    (m) =>
      isLive(m) &&
      m.topic === opts.topicKey &&
      m.audience === opts.audienceKey,
  );
  const variant = liveInCell.some((m) => m.number === draft.number)
    ? nextVariantForNumber(liveInCell, draft.number)
    : draft.variant;

  const patterns = await readClientPatterns(clientId);
  const audienceList = [
    ...(await listAudiences(clientId)),
    ...(await listChannels(clientId)).map(channelToAudience),
  ];
  const identity = regeneratedIdentity(
    {
      audience: opts.audienceKey,
      topic: opts.topicKey,
      number: draft.number,
      variant,
      versionNo: draft.versionNo,
      landingUrl: draft.landingUrl,
    },
    { audienceRow, topicRow, patterns, audienceList },
  );

  const [row] = await db
    .update(messages)
    .set({
      audience: opts.audienceKey,
      topic: opts.topicKey,
      variant,
      // Status and audience have to land in the SAME write: the schema check
      // ties them together, so splitting this into two updates would be
      // rejected by whichever half went first.
      status: opts.status ?? "PREVIEW",
      ...identity,
      version: sql`${messages.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)))
    .returning();
  return row;
}

// Throw a draft away for good — the row is gone, and with it the claim on its
// MC number, which the next draft is then free to take.
//
// This is the one place a card is HARD-deleted from the UI, and it is safe
// here for the reason that makes a draft a draft: it has no cell, so nothing
// is trafficked against it, no PMMID was ever minted (the schema forbids one
// on a draft), no feed row cites it and no report can be joined to it.
// Archiving is the right end for a card that lived; a draft created by mistake
// never did, and archiving one only burns its number for nothing.
//
// Deliberately NOT routed through deleteMessages: that one addresses rows by
// PMMID, which a draft cannot have.
export async function deleteDraft(
  clientId: number,
  id: number,
  expectedVersion: number,
): Promise<
  | { ok: true; row: Message }
  | { ok: false; reason: "not_found" | "not_a_draft" | "version_conflict"; current: Message | null }
> {
  const row = await getMessage(clientId, id);
  if (!row) return { ok: false, reason: "not_found", current: null };
  if (row.status !== "DRAFT" || row.audience !== null) {
    return { ok: false, reason: "not_a_draft", current: row };
  }
  if (row.version !== expectedVersion) {
    return { ok: false, reason: "version_conflict", current: row };
  }
  // message_previews cascade with the row (ON DELETE CASCADE), so the shot
  // PNGs' rows go too; the bytes in the object store are left, as everywhere.
  await db
    .delete(messages)
    .where(and(eq(messages.clientId, clientId), eq(messages.id, id)));
  return { ok: true, row };
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
  //
  // A DRAFT is skipped entirely: every trafficking column is derived from the
  // cell (audience/topic patterns), and a draft has no cell. Generating them
  // from a placeholder would mint a measurement key for something that is not
  // being measured — promotion is where the identity is born.
  const merged = { ...current, ...input };
  // The schema ties placement and status together (checks
  // `messages_draft_has_no_audience` / `messages_placed_has_topic`), and a PATCH
  // can touch either side. Catching the mismatch here turns a raw database error
  // into an actionable one that names the operation which does this legally.
  const mergedIsDraft = merged.status === "DRAFT";
  const mergedIsPlaced = (merged.audience ?? null) !== null;
  if (mergedIsDraft === mergedIsPlaced) {
    throw new MessageError(
      mergedIsDraft
        ? "a DRAFT cannot sit in a cell — a draft is defined by having no audience"
        : "a card in the matrix needs an audience — promote sets the status and the cell in one step",
    );
  }
  if (mergedIsPlaced && (merged.topic ?? null) === null) {
    throw new MessageError(
      "a card in the matrix needs a topic — a cell is an (audience, topic) pair",
    );
  }
  const patterns = await readClientPatterns(clientId);
  const traffic = isPlaced(merged)
    ? traffickingColumns(
        {
          number: merged.number,
          variant: merged.variant,
          audience: merged.audience,
          topic: merged.topic,
          versionNo: merged.versionNo,
          landingUrl: merged.landingUrl,
        },
        {
          audienceRow: await findAudienceByKey(clientId, merged.audience),
          topicRow: await findTopicByKey(clientId, merged.topic),
          patterns,
          audienceList: await listAudiences(clientId),
        },
        current.pmmid,
      )
    : {};
  const [updated] = await db
    .update(messages)
    .set({
      ...input,
      ...traffic,
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
// (see nextMcSlot): a DCO number may be claimed for its static Agentic twin, so
// (number, variant) alone can name TWO different cards — the DCO one and its
// Agentic namesake in another topic. The family is therefore (number, variant)
// WITHIN one axis. Channels are merged in as Audience-shaped rows so an Agentic
// row's `ch_*` audience key resolves to a channel (⇒ Agentic); a key that
// resolves to nothing counts as DCO, matching nextMcSlot's `sameAxis`.
async function sameAxisAs(
  clientId: number,
  primary: PlacedMessage,
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
// A DRAFT has no siblings by construction: it sits on no axis and in no cell,
// so there is nothing for a global edit to fan out to.
export async function findSiblings(
  clientId: number,
  primary: Message,
): Promise<PlacedMessage[]> {
  if (!isPlaced(primary)) return [];
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, primary.number),
        eq(messages.variant, primary.variant),
        isNull(messages.archivedAt),
        PLACED_ONLY,
      ),
    );
  const onAxis = await sameAxisAs(clientId, primary);
  return rows
    .filter(isPlaced)
    .filter((m) => m.id !== primary.id && onAxis(m));
}

// Apply the shared subset of `input` to the rest of the card family. Every
// shared field (creative, status, flight dates) goes to the audience copies of
// the same (number, variant) ON THE SAME AXIS — a DCO card and its static
// Agentic namesake share a number but are different cards, so a global edit on
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
  // Nothing to propagate FROM a draft — it has no family (see findSiblings).
  if (!isPlaced(primary)) return [];
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
          PLACED_ONLY,
        ),
      )
  )
    .filter(isPlaced)
    .filter((m) => m.id !== primary.id && onAxis(m));

  const changes: Array<{ before: Message; after: Message }> = [];
  for (const sib of family) {
    const sameVariant = sib.variant === primary.variant;
    const payload = sameVariant
      ? { ...numberPayload, ...cardPayload }
      : { ...numberPayload };
    if (Object.keys(payload).length === 0) continue;

    let trafficFields: Record<string, unknown> = {};
    if (sameVariant) {
      // audience/topic are restated from the sibling rather than cast: they
      // cannot be in `payload` (CARD_FIELDS drops both, since placement is
      // per-copy), and this way the placement's provenance is on the line.
      const merged: PlacedMessage = {
        ...sib,
        ...payload,
        audience: sib.audience,
        topic: sib.topic,
      };
      trafficFields = traffickingColumns(
        {
          number: merged.number,
          variant: merged.variant,
          audience: merged.audience,
          topic: merged.topic,
          versionNo: merged.versionNo,
          landingUrl: merged.landingUrl,
        },
        {
          audienceRow: await findAudienceByKey(clientId, merged.audience),
          topicRow: await findTopicByKey(clientId, merged.topic),
          patterns,
          audienceList,
        },
        sib.pmmid,
      );
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

  // A DRAFT has no parents to be archived behind — it points at no cell — so
  // the guard simply does not apply and restoring it always proceeds.
  if (isPlaced(current)) {
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
  // Sources are looked up BY PMMID, and a draft has none (DB check
  // `messages_draft_has_no_pmmid`), so a draft can never be resolved here — the
  // guard states that rule at the boundary instead of leaving it implicit, and
  // gives the caller the actual next step if it ever does arrive.
  const sources: PlacedMessage[] = [];
  for (const label of sourceMcLabels) {
    const source = await getMessageByPmmid(clientId, label);
    if (!source) {
      throw new MessageError(`message '${label}' not found`);
    }
    if (!isPlaced(source)) {
      throw new MessageError(
        `'${label}' is a draft — promote it into a cell first; copy duplicates a placed card`,
      );
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
    source: PlacedMessage;
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

    const identity = regeneratedIdentity(
      {
        audience: p.targetAud,
        topic: p.source.topic,
        number: p.number,
        variant: p.variant,
        versionNo: 1,
        landingUrl: { ...cloneable, ...overrides }.landingUrl,
      },
      { audienceRow, topicRow, patterns, audienceList },
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
        ...identity,
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

// Which statuses lock a row against placement changes and hard delete now lives
// in @/lib/mc-status (isMeasurementLocked) — the matrix grid needs the same
// answer for its delete dialog, and it used to keep a second copy of the list.


// Move messages into a single target audience. Same-topic only. PMMID is
// regenerated against the new audience (it encodes audience/topic/number/
// variant/versionNo — moving without regen would make the key lie about the
// row's content). versionNo (the creative-revision counter) stays frozen — a
// move is a placement change, not a creative revision. UTM columns are also
// regenerated. Measurement-locked rows are rejected up front.
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
    source: PlacedMessage;
    topicRow: Topic | null;
  };
  const resolved: Resolved[] = [];
  for (const m of moves) {
    const source = await getMessageByPmmid(clientId, m.mcLabel);
    // Unreachable for a draft in practice — a draft has no pmmid to match on
    // (DB check `messages_draft_has_no_pmmid`) — so an unplaced hit here means
    // no such placed card exists, which is exactly `not_found`.
    if (!source || !isPlaced(source)) {
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
    if (isMeasurementLocked(source.status)) {
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
    const identity = regeneratedIdentity(
      {
        audience: targetAudienceKey,
        topic: p.source.topic,
        number: p.number,
        variant: p.variant,
        versionNo: p.source.versionNo,
        landingUrl: p.source.landingUrl,
      },
      {
        audienceRow: targetAudience,
        topicRow: p.topicRow,
        patterns,
        audienceList,
      },
    );
    const [row] = await db
      .update(messages)
      .set({
        audience: targetAudienceKey,
        number: p.number,
        variant: p.variant,
        ...identity,
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
//   * measurement-locked (isMeasurementLocked) → archive is the only way out of a measured
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
    if (isMeasurementLocked(row.status)) {
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
