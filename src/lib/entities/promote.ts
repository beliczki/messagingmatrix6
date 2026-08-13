import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  prodlistRows,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "@/db/schema";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";
import { createMessage } from "./messages";
import { createTopic } from "./topics";
import { getCreative, updateCreative } from "./creatives";

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

async function findAudienceByChannel(
  clientId: number,
  channel: string,
): Promise<Audience | null> {
  const [row] = await db
    .select()
    .from(audiences)
    .where(
      and(
        eq(audiences.clientId, clientId),
        eq(audiences.channel, channel),
        isNull(audiences.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
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
  topic: Topic;
  audience: Audience;
};

// Promote an uploaded creative into a nonDCO MC: a template-less messages row
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
  if (creative.mcNumber != null && creative.mcVariant != null) {
    throw new PromoteError(
      `creative ${creativeId} is already matrixed (MC${creative.mcNumber}${creative.mcVariant})`,
    );
  }

  const channel =
    opts.channel ?? (await channelFromProdlist(clientId, creative.familyKey));
  if (!channel) {
    throw new PromoteError(
      `no channel for creative ${creativeId} — pass channel explicitly or ingest a matching prodlist row`,
    );
  }
  const audience = await findAudienceByChannel(clientId, channel);
  if (!audience) {
    throw new PromoteError(
      `no channel-audience for channel '${channel}' — seed the channel audiences first`,
    );
  }

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
