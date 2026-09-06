import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  messages,
  prodlistRows,
  topics,
  type Audience,
  type Creative,
  type Message,
  type Topic,
} from "@/db/schema";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";
import { regeneratedIdentity } from "@/lib/message-identity";
import { isLive } from "@/lib/numbering";
import { createMessage, readClientPatterns } from "./messages";
import { createTopic } from "./topics";
import {
  createCreative,
  getCreative,
  updateCreative,
  type CreativeInput,
} from "./creatives";
import { listAudiences } from "./audiences";
import { channelToAudience, findChannelByCode, listChannels } from "./channels";

export class PromoteError extends Error {}

// Auto-topic normalization tokens to drop. Deterministic + collision-stable so
// repeated promotions of the same family converge on ONE topic key (which
// freezes on first reference).
const QUARTER_RE = /^\d{4}q\d$/i; // 2026Q1
const VERSION_TOKEN_RE = /^n\d+$/i; // n3
const DIM_TOKEN_RE = /^\d{2,5}x\d{2,5}$/i; // 300x250 (defensive; parser strips these)
const HINT_STOPWORDS = new Set([
  "fullimage",
  "halfimage",
  "fullbanner",
  "static",
]);

// Derive a stable topic {key,name} from a creative filename. Uses the parsed
// `keywords` (tokens after the MC marker) minus quarter/version/size/render-hint
// noise. Falls back to product, then "creative".
export function autoTopicFromFilename(filename: string): {
  key: string;
  name: string;
} {
  const parsed = parseCreativeFilename(filename);
  let tokens = parsed.keywords
    .split(/\s+/)
    .filter(
      (t) =>
        t.length > 0 &&
        !QUARTER_RE.test(t) &&
        !VERSION_TOKEN_RE.test(t) &&
        !DIM_TOKEN_RE.test(t) &&
        !HINT_STOPWORDS.has(t.toLowerCase()),
    );
  if (tokens.length === 0 && parsed.product) tokens = [parsed.product];
  if (tokens.length === 0) tokens = ["creative"];
  const key =
    tokens
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "creative";
  const name = tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(" ");
  return { key, name };
}

async function findTopicByKey(
  clientId: number,
  key: string,
): Promise<Topic | null> {
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
    .limit(1);
  return row ?? null;
}

// The creative's channel, matched from prodlist deliverables by familyKey.
// Explicit `channel` at the call site always wins; this is the assist.
async function channelFromProdlist(
  clientId: number,
  familyKey: string | null,
): Promise<string | null> {
  if (!familyKey) return null;
  const [row] = await db
    .select({ channel: prodlistRows.channel })
    .from(prodlistRows)
    .where(
      and(
        eq(prodlistRows.clientId, clientId),
        eq(prodlistRows.familyKey, familyKey),
        isNull(prodlistRows.archivedAt),
      ),
    )
    .limit(1);
  return row?.channel ?? null;
}

export type PromoteResult = {
  message: Message;
  // A filename-numbered creative lands at an Agentic topic, and those are
  // message strings the grid synthesizes its rows from — there is usually no
  // topics-table row behind one.
  topic: Topic | { key: string };
  audience: Audience;
};

// Promote an uploaded creative into an Agentic MC: a template-less messages row
// (image1 = the creative file) on the channel-audience, at an auto-topic, with
// the creative back-linked via mcNumber/mcVariant. The creatives row stays the
// file record; the message is its matrix mirror.
export async function promoteCreative(
  clientId: number,
  creativeId: number,
  opts: { channel?: string; topicOverride?: string } = {},
): Promise<PromoteResult> {
  const creative = await getCreative(clientId, creativeId);
  if (!creative) throw new PromoteError(`creative ${creativeId} not found`);
  if (!creative.fileName) {
    throw new PromoteError(`creative ${creativeId} has no fileName to promote`);
  }
  // A creative whose filename already names an MC is not asking for a number,
  // it is stating one. Route it to the mirror, which honours that number.
  //
  // "Already matrixed" is a question about the MATRIX, and answering it from
  // mc_number/mc_variant answers a different one: the Creative Library fills
  // both straight from the filename at upload, so they read "MC324b" long
  // before any message exists. Every delivered file uploaded after the last
  // batch import was refused here for being what it had only been named.
  if (creative.mcNumber != null) {
    if (opts.topicOverride) {
      throw new PromoteError(
        `creative ${creativeId} is numbered by its filename (MC${creative.mcNumber}${creative.mcVariant ?? "a"}) — its topic follows that number's existing cell, so topic_override does not apply`,
      );
    }
    const mirror = await ensureAgenticMc(clientId, creative, {
      channel: opts.channel,
    });
    if (mirror.reason === "no-channel") {
      throw new PromoteError(
        `no channel '${opts.channel ?? "DISP/SOC"}' — add it under Settings › Channels first`,
      );
    }
    if (mirror.reason === "exists") {
      throw new PromoteError(
        `creative ${creativeId} is already matrixed (MC${creative.mcNumber}${creative.mcVariant ?? "a"})`,
      );
    }
    if (!mirror.created) {
      throw new PromoteError(
        `creative ${creativeId} cannot be matrixed (${mirror.reason})`,
      );
    }
    const topicKey = mirror.message.topic!;
    return {
      message: mirror.message,
      topic: (await findTopicByKey(clientId, topicKey)) ?? { key: topicKey },
      audience: mirror.audience,
    };
  }

  const channel =
    opts.channel ?? (await channelFromProdlist(clientId, creative.familyKey));
  if (!channel) {
    throw new PromoteError(
      `no channel for creative ${creativeId} — pass channel explicitly or ingest a matching prodlist row`,
    );
  }
  const channelRow = await findChannelByCode(clientId, channel);
  if (!channelRow) {
    throw new PromoteError(
      `no channel '${channel}' — add it under Settings › Channels first`,
    );
  }
  const audience = channelToAudience(channelRow);

  const fileName = creative.fileName;
  const creativeVersion = creative.version;

  return db.transaction(async () => {
    let topic: Topic | null;
    if (opts.topicOverride) {
      topic = await findTopicByKey(clientId, opts.topicOverride);
      if (!topic) {
        throw new PromoteError(`topic '${opts.topicOverride}' not found`);
      }
    } else {
      const auto = autoTopicFromFilename(fileName);
      topic =
        (await findTopicByKey(clientId, auto.key)) ??
        (await createTopic(clientId, { key: auto.key, name: auto.name }));
    }

    const message = await createMessage(clientId, {
      audience: audience.key,
      topic: topic.key,
      image1: fileName,
      name: fileName,
      // Same reasoning as scripts/rebuild-creatives.ts: what gets promoted is a
      // finished, delivered creative file, not a card someone still has to write.
      // Without this it would inherit createMessage's INCOMING default.
      status: "ACTIVE",
    });

    const upd = await updateCreative(clientId, creativeId, creativeVersion, {
      mcNumber: message.number,
      mcVariant: message.variant,
    });
    if (!upd.ok) {
      throw new PromoteError(
        `creative ${creativeId} changed concurrently during promotion — retry`,
      );
    }

    return { message, topic, audience };
  });
}

// ---------------------------------------------------------------------------
// Filename-numbered creatives → their Agentic matrix mirror.
//
// A creative whose filename already says MC324_b is not asking for a NEW MC
// identity — it is naming one. promoteCreative allocates a number; this
// function honours the one the file carries, which is why it inserts directly
// instead of going through createMessage (that function's DCO-oriented guards
// refuse a number that already lives in another cell, and Agentic topics are
// message strings with no row in the topics table for it to resolve).
//
// The same rules the batch import used (scripts/rebuild-creatives.ts step 4),
// so a file that arrives through the UI lands where the batch would have put
// it: one message per (number, variant, channel), channel from the declared
// size, topic inherited from the number's existing siblings.
// ---------------------------------------------------------------------------

// Channel from size — user-locked, v1 (scripts/rebuild-creatives.ts:26).
const SOC_SIZES = new Set(["1080x1080", "1200x628"]);

export type MirrorSkip =
  | "no-mc-number"
  | "no-file"
  | "no-channel"
  | "exists"
  | "archived-twin";

export type MirrorResult =
  | { created: true; reason: null; message: Message; audience: Audience }
  | {
      created: false;
      reason: MirrorSkip;
      message: Message | null;
      audience: Audience | null;
    };

export function channelCodeForSize(dimensions: string | null): "SOC" | "DISP" {
  return dimensions && SOC_SIZES.has(dimensions.toLowerCase()) ? "SOC" : "DISP";
}

// The number's topic, as the matrix already knows it. A number never spans
// topics within an axis, so any existing sibling answers for all of them —
// MC324b belongs in the cell MC324a is already sitting in, whatever that
// topic string happens to be.
async function agenticTopicForNumber(
  clientId: number,
  number: number,
  channelKeys: string[],
): Promise<string | null> {
  if (channelKeys.length === 0) return null;
  const rows = await db
    .select({
      topic: messages.topic,
      status: messages.status,
      archivedAt: messages.archivedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, number),
        inArray(messages.audience, channelKeys),
      ),
    )
    .orderBy(asc(messages.id));
  const sibling = rows.find((r) => isLive(r) && r.topic);
  return sibling?.topic ?? null;
}

// Fallback for a number the matrix has never seen: "<PRODUCT>_<keywords>",
// the shape the batch import wrote (no topics-table row — the Agentic grid
// synthesizes its rows from these strings).
function topicFromCreative(creative: Creative): string {
  const parsed = parseCreativeFilename(creative.fileName ?? "");
  const keywords = parsed.keywords.trim().split(/\s+/).filter(Boolean).join("_");
  const product = creative.product ?? parsed.product ?? "";
  return [product, keywords].filter(Boolean).join("_").slice(0, 200) || "creative";
}

// Ensure the Agentic MC named by this creative's filename exists. Creates the
// missing (number, variant, channel) cell; never touches one that is already
// there — image1 on an existing card may have been curated by hand, and a
// later-arriving size is not a reason to overwrite it.
export async function ensureAgenticMc(
  clientId: number,
  creative: Creative,
  opts: { channel?: string } = {},
): Promise<MirrorResult> {
  if (creative.mcNumber == null) {
    return { created: false, reason: "no-mc-number", message: null, audience: null };
  }
  if (!creative.fileName) {
    return { created: false, reason: "no-file", message: null, audience: null };
  }
  const number = creative.mcNumber;
  const variant = (creative.mcVariant ?? "a").toLowerCase();

  const parsed = parseCreativeFilename(creative.fileName);
  const dimensions = parsed.declaredDimensions ?? creative.fileDimensions;
  const code = opts.channel ?? channelCodeForSize(dimensions);
  const channelRow = await findChannelByCode(clientId, code);
  // A client with no channels has no Agentic axis to mirror into — that is a
  // shape of the data, not a failure, so the caller decides whether it matters
  // (an upload shrugs; an explicit promote reports it).
  if (!channelRow) {
    return { created: false, reason: "no-channel", message: null, audience: null };
  }
  const audienceRow = channelToAudience(channelRow);

  const existing = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        eq(messages.number, number),
        eq(messages.variant, variant),
        eq(messages.audience, audienceRow.key),
      ),
    )
    .orderBy(asc(messages.id));
  const live = existing.find(isLive);
  if (live) {
    return { created: false, reason: "exists", message: live, audience: audienceRow };
  }
  if (existing.length > 0) {
    // A restore would resurrect a duplicate PMMID — same reasoning as
    // createMessage's dormant-twin guard.
    return {
      created: false,
      reason: "archived-twin",
      message: existing[0],
      audience: audienceRow,
    };
  }

  const channelList = await listChannels(clientId);
  const channelKeys = channelList.map((c) => c.key);
  const topic =
    (await agenticTopicForNumber(clientId, number, channelKeys)) ??
    topicFromCreative(creative);

  const audienceList = [
    ...(await listAudiences(clientId)),
    ...channelList.map(channelToAudience),
  ];
  const patterns = await readClientPatterns(clientId);
  const identity = regeneratedIdentity(
    {
      audience: audienceRow.key,
      topic,
      number,
      variant,
      versionNo: 1,
      landingUrl: null,
    },
    { audienceRow, topicRow: null, patterns, audienceList },
  );

  const [row] = await db
    .insert(messages)
    .values({
      clientId,
      number,
      variant,
      // A delivered creative file, not a card someone still has to write —
      // the same call scripts/rebuild-creatives.ts makes, and for the same
      // reason (the INCOMING/PREVIEW birth statuses describe a moment that
      // has already passed by the time the file exists).
      status: "ACTIVE",
      audience: audienceRow.key,
      topic,
      versionNo: 1,
      template: null,
      image1: creative.fileName,
      name: creative.fileName,
      ...identity,
    })
    .returning();
  return { created: true, reason: null, message: row, audience: audienceRow };
}

// The Creative Library's write path. Uploading a correctly-named creative is
// how an Agentic MC is meant to arrive (MatrixToolbar says so on the Agentic
// tab), so the file and the matrix cell it names are created together — until
// this existed, `createCreative` wrote the row and the matrix never heard
// about it.
export async function createCreativeWithMirror(
  clientId: number,
  input: CreativeInput,
): Promise<Creative> {
  const creative = await createCreative(clientId, input);
  await ensureAgenticMc(clientId, creative);
  return creative;
}
