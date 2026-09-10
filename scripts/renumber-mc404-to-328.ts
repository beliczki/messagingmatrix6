/**
 * One-off: renumber the DCO MC404a (html, HK_INCOMING /
 * HK_edukacio_nehezseg_benefit_easypay) to MC328a so it pairs with the static
 * Agentic MC328 EasyPay set, and fill its content fields from the reference
 * design (user, 2026-09-09).
 *
 * Why a script: `number` is deliberately not in WRITABLE_FIELDS — updateMessage
 * cannot renumber, and there is no renumber operation. Renumbering by hand in
 * SQL would leave pmmid / utm_term / utm_cd26 / final_trafficked_url carrying
 * the old 404, so the identity columns are rebuilt here with the same
 * `regeneratedIdentity` create/copy/move/rekey use.
 *
 * Verified safe before running: nothing references 404 — no message_previews,
 * no creatives.mc_number, no monitoring row, no prodlist_rows. Number 328 is
 * free on the DCO axis (the existing 328a–c are Agentic, channel-placed), and
 * cross-axis reuse of a number is explicitly allowed (see createMessage).
 *
 *   npx tsx scripts/renumber-mc404-to-328.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, messages, topics, nowUtc } from "@/db/schema";
import { readClientPatterns } from "@/lib/entities/messages";
import { listAudiences } from "@/lib/entities/audiences";
import { regeneratedIdentity } from "@/lib/message-identity";

const ID = 35991;
const NEW_NUMBER = 328;

async function main() {
  const [current] = await db.select().from(messages).where(eq(messages.id, ID));
  if (!current) throw new Error(`message ${ID} not found`);
  if (!current.audience || !current.topic) {
    throw new Error("message is not placed — renumbering needs a cell");
  }
  console.log("before:", {
    mc: `${current.number}${current.variant}`,
    pmmid: current.pmmid,
    version: current.version,
  });

  const clientId = current.clientId;
  const [audienceRow] = await db
    .select()
    .from(audiences)
    .where(
      and(eq(audiences.clientId, clientId), eq(audiences.key, current.audience)),
    );
  const [topicRow] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.clientId, clientId), eq(topics.key, current.topic)));
  if (!audienceRow || !topicRow) throw new Error("audience/topic row missing");

  const identity = regeneratedIdentity(
    {
      audience: current.audience,
      topic: current.topic,
      number: NEW_NUMBER,
      variant: current.variant ?? "a",
      versionNo: current.versionNo,
      landingUrl: current.landingUrl,
    },
    {
      audienceRow,
      topicRow,
      patterns: await readClientPatterns(clientId),
      audienceList: await listAudiences(clientId),
    },
  );

  const [updated] = await db
    .update(messages)
    .set({
      number: NEW_NUMBER,
      ...identity,
      name: "Szeletelt telefon",
      headline: "EasyPay",
      copy1: "Nagyobb hitelkártya költéseid szétoszthatod több hónapra.",
      flash: "Akár <b>0%</b> kamattal",
      cta: "Érdekel",
      image1: "empty.png",
      templateVariantClasses: "fullSurfaceColor objectGfx",
      version: current.version + 1,
      updatedAt: nowUtc,
    })
    .where(and(eq(messages.clientId, clientId), eq(messages.id, ID)))
    .returning();

  console.log("after:", {
    mc: `${updated.number}${updated.variant}`,
    pmmid: updated.pmmid,
    utmTerm: updated.utmTerm,
    utmCd26: updated.utmCd26,
    finalTraffickedUrl: updated.finalTraffickedUrl,
    version: updated.version,
  });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
