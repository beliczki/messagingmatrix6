// Renumber DCO-axis MCs and regenerate the derived identity columns (pmmid +
// the seven trafficking columns) from the new number.
//
// Why this exists: `number` is deliberately NOT a writable field — createMessage
// owns allocation and there is no supported "change the number" path, because a
// renumber rewrites the measurement identity of every row it touches. This is
// the explicit, preview-first tool, modelled on entities/rekey.ts: same blocker
// checks, same "regenerate identity, never rewrite shipped history" rule, same
// per-row audit trail.
//
// AXIS-SCOPED. Numbering is per axis (DCO = audience with no channel, Agentic =
// channel audience), so one MC number can name two different cards: a DCO
// campaign card and a static creative. Only the DCO side moves here, so the
// Agentic card keeps its number and its `creatives` rows (linked by
// mc_number+mc_variant, which carries no axis) stay correct.
//
// A target number free on the DCO axis but taken on the Agentic axis is NOT
// refused — that is a legal cross-axis twin. Check the Agentic side yourself
// when the point of the move is to stop sharing a number with an unrelated
// campaign; docs/mc-collisions.html is the map.
//
// What it NEVER rewrites: feed_exports payloads, monitoring rows, snapshots.
// Those record what actually shipped / what a platform reported. They are
// blocker inputs instead — an uploaded feed or a monitoring row refuses the run.
//
// Usage:
//   MAP=5:10 npx tsx scripts/renumber-mc-dco.ts            # dry run
//   MAP=5:10 npx tsx scripts/renumber-mc-dco.ts --commit

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  clients,
  config,
  feedExports,
  messages,
  monitoring,
  nowUtc,
  topics,
  type Audience,
  type Message,
  type Topic,
} from "../src/db/schema";
import { regeneratedIdentity } from "../src/lib/message-identity";
import { listAudiences } from "../src/lib/entities/audiences";
import { listChannels, channelToAudience } from "../src/lib/entities/channels";
import { writeAudit } from "../src/lib/audit";
import { type TraffickingPatterns } from "../src/lib/trafficking";

const COMMIT = process.argv.includes("--commit");
const CLIENT_KEY = process.env.CLIENT_KEY ?? "erste";
const MAP = (process.env.MAP ?? "")
  .split(",")
  .filter(Boolean)
  .map((pair) => pair.split(":").map((s) => Number(s.trim())))
  .map(([from, to]) => ({ from, to }));

type ClientPatterns = { pmmid?: string; trafficking?: TraffickingPatterns };

async function main() {
  if (MAP.length === 0) throw new Error("MAP is required, e.g. MAP=5:10");
  if (MAP.some((m) => !Number.isFinite(m.from) || !Number.isFinite(m.to))) {
    throw new Error(`MAP is not a from:to,from:to list: ${process.env.MAP}`);
  }

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.key, CLIENT_KEY))
    .limit(1);
  if (!client) throw new Error(`client '${CLIENT_KEY}' not found`);
  const clientId = client.id;

  // The audience list the pmmid/trafficking patterns resolve
  // `{{audiences[Audience_Key].Field}}` against, plus the channel→axis map.
  const channels = await listChannels(clientId);
  const audienceList: Audience[] = [
    ...(await listAudiences(clientId)),
    ...channels.map(channelToAudience),
  ];
  const channelKeys = new Set(channels.map((c) => c.key));
  const isDco = (m: { audience: string }) => !channelKeys.has(m.audience);

  const [patternRow] = await db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .limit(1);
  const patterns: ClientPatterns = patternRow
    ? (JSON.parse(patternRow.value) as ClientPatterns)
    : {};

  const all = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.clientId, clientId),
        inArray(
          messages.number,
          MAP.flatMap((m) => [m.from, m.to]),
        ),
      ),
    )
    .orderBy(messages.number, messages.variant, messages.audience);

  const plans: { from: number; to: number; rows: Message[] }[] = [];
  const blockers: string[] = [];

  for (const { from, to } of MAP) {
    const rows = all.filter((m) => m.number === from && isDco(m));
    if (rows.length === 0) {
      blockers.push(`MC${from}: no DCO-axis rows found`);
      continue;
    }
    // The target must be free ON THE DCO AXIS — including archived rows, which
    // still hold their number (a restore would otherwise collide).
    const taken = all.filter((m) => m.number === to && isDco(m));
    if (taken.length > 0) {
      blockers.push(
        `MC${to} is already in use on the DCO axis by topic '${taken[0].topic}' (${taken.length} rows)`,
      );
    }
    const topicKeys = [...new Set(rows.map((r) => r.topic))];
    if (topicKeys.length > 1) {
      blockers.push(
        `MC${from} spans several DCO topics (${topicKeys.join(", ")}) — refusing a blind renumber`,
      );
    }
    // Not a blocker, just worth knowing: the target may already name a static
    // card on the other axis.
    const twin = all.filter((m) => m.number === to && !isDco(m));
    if (twin.length > 0) {
      console.log(
        `  note: MC${to} also names a nonDCO card ('${twin[0].topic}') — legal cross-axis twin, but check it is the same campaign`,
      );
    }

    // Has this number already left the building?
    const shipped = await db
      .select({ id: feedExports.id, v: feedExports.feedVersion })
      .from(feedExports)
      .where(
        and(
          eq(feedExports.clientId, clientId),
          isNotNull(feedExports.uploadedToAdformAt),
          sql`strpos(${feedExports.payloadJson}, ${"-m_" + from + "-"}) > 0`,
        ),
      );
    for (const f of shipped) {
      blockers.push(
        `MC${from} appears in feed export #${f.id} (v${f.v}) that was already uploaded to Adform`,
      );
    }
    const [mon] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(monitoring)
      .where(
        and(eq(monitoring.clientId, clientId), eq(monitoring.mcNumber, from)),
      );
    if ((mon?.n ?? 0) > 0) {
      blockers.push(`MC${from} has ${mon.n} monitoring rows`);
    }

    plans.push({ from, to, rows });
  }

  for (const { from, to, rows } of plans) {
    const sample = rows[0];
    const after = await identityFor(clientId, sample, to, patterns, audienceList);
    console.log(
      `\nMC${from} → MC${to}  (${rows.length} rows, topic '${sample.topic}', variants ${[
        ...new Set(rows.map((r) => r.variant)),
      ].join(",")})`,
    );
    console.log(`  pmmid before: ${sample.pmmid}`);
    console.log(`  pmmid after : ${after.pmmid}`);
    console.log(`  utm_term before: ${sample.utmTerm}`);
    console.log(`  utm_term after : ${after.utmTerm}`);
  }

  if (blockers.length > 0) {
    console.error(`\nBLOCKED:\n${blockers.map((b) => `  - ${b}`).join("\n")}`);
    process.exit(1);
  }
  if (!COMMIT) {
    console.log("\nDry run — pass --commit to write.");
    return;
  }

  let n = 0;
  await db.transaction(async () => {
    for (const { to, rows } of plans) {
      for (const before of rows) {
        const identity = await identityFor(
          clientId,
          before,
          to,
          patterns,
          audienceList,
        );
        const [after] = await db
          .update(messages)
          .set({
            number: to,
            ...identity,
            version: sql`${messages.version} + 1`,
            updatedAt: nowUtc,
          })
          .where(
            and(eq(messages.clientId, clientId), eq(messages.id, before.id)),
          )
          .returning();
        await writeAudit({
          clientId,
          userId: null,
          entityType: "messages",
          entityId: before.id,
          action: "update",
          before,
          after,
          silent: true,
        });
        n++;
      }
    }
  });
  console.log(`\nCommitted — ${n} messages renumbered.`);
}

async function identityFor(
  clientId: number,
  row: Message,
  newNumber: number,
  patterns: ClientPatterns,
  audienceList: Audience[],
) {
  return regeneratedIdentity(
    {
      audience: row.audience,
      topic: row.topic,
      number: newNumber,
      variant: row.variant,
      versionNo: row.versionNo,
      landingUrl: row.landingUrl,
    },
    {
      audienceRow: audienceList.find((a) => a.key === row.audience) ?? null,
      topicRow: await topicByKey(clientId, row.topic),
      patterns,
      audienceList,
    },
  );
}

const topicCache = new Map<string, Topic | null>();
async function topicByKey(clientId: number, key: string): Promise<Topic | null> {
  const hit = topicCache.get(key);
  if (hit !== undefined) return hit;
  const [row] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, key)))
    .limit(1);
  topicCache.set(key, row ?? null);
  return row ?? null;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
