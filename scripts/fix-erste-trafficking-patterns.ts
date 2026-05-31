/**
 * One-off migration: install the real Erste (v5) pmmid + trafficking patterns
 * into config.patterns, and backfill the MCs that were created/copied/moved
 * under the generic DEFAULT patterns (wrong utm_cd26, empty Final-trafficked-URL).
 *
 * Why this exists: Erste's config.patterns held the generic DEFAULT_PATTERNS, so
 * `utm_cd26 = {{product}}_{{audience}}`, `utm_campaign = {{product|lower}}` … and
 * there was no `final_trafficked_url` key at all. Imported MCs kept their
 * pre-computed v5 values from the XLSX (pmmid `p_…`, full Final URL), but anything
 * generated in v6 (create/copy/move, and "regenerate on every save") came out
 * wrong. The code fix (src/lib/trafficking.ts + entities/messages.ts) makes
 * generation honour by-key patterns; this script supplies the patterns and
 * repairs the affected rows.
 *
 * Verified safe before running: `feed_exports` is empty (no feed ever uploaded to
 * AdForm) and monitoring matches on mc/audience/topic (not pmmid) — so rewriting
 * the `a_…` pmmid → `p_…` on these ACTIVE rows orphans no live measurement.
 *
 * Scope: pmmid + trafficking patterns only (feed/topicKey/audienceKey untouched).
 * Backfill defaults to MC314 + MC315 (all variants); override with MC_NUMBERS.
 *
 * Idempotent. Pass --dry-run to preview without writing.
 *
 *   MM6_DB_PATH=db/matrix.db npx tsx scripts/fix-erste-trafficking-patterns.ts --dry-run
 *   MM6_DB_PATH=db/matrix.db npx tsx scripts/fix-erste-trafficking-patterns.ts
 *   MC_NUMBERS=314,315,316 MM6_DB_PATH=db/matrix.db npx tsx scripts/...
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
import { generatePmmid } from "@/lib/pmmid";
import { generateTrafficking } from "@/lib/trafficking";

const DRY_RUN = process.argv.includes("--dry-run");
const CLIENT_KEY = process.env.CLIENT_KEY ?? "erste";
const MC_NUMBERS = (process.env.MC_NUMBERS ?? "314,315")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));

// The real Erste patterns (v5 ground truth — tests/fixtures/v5/dataset/config.json).
const ERSTE_PMMID =
  "p_{{audiences[Audience_Key].Buying_platform}}-s_{{audiences[Audience_Key].Strategy}}-a_{{Audience_Key}}-m_{{Number}}-t_{{Topic_Key}}-v_{{Variant}}-n_{{Version}}";

const ERSTE_TRAFFICKING = {
  utm_campaign: "{{audiences[Audience_Key].Campaign_name}}",
  utm_source: "{{audiences[Audience_Key].Buying_platform}}",
  utm_medium: "display",
  utm_content: "banner",
  utm_term:
    "con!{{audiences[Audience_Key].Buying_platform}}!{{Audience_Key}}!...!hu!{{Number}}{{Variant}}",
  utm_cd26: "{{PMMID}}",
  final_trafficked_url:
    "{{Landing_URL}}?utm_campaign={{utm_campaign}}&utm_source={{utm_source}}&utm_medium={{utm_medium}}&utm_content={{utm_content}}&utm_term={{utm_term}}&utm_cd26={{utm_cd26}}&",
};

function main() {
  const client = db
    .select()
    .from(clients)
    .where(eq(clients.key, CLIENT_KEY))
    .get();
  if (!client) throw new Error(`client '${CLIENT_KEY}' not found`);
  const clientId = client.id;
  console.log(
    `Client: ${client.name} (id=${clientId})  dryRun=${DRY_RUN}  MCs=[${MC_NUMBERS.join(",")}]`,
  );

  // ── 1. Install patterns (merge — keep feed/topicKey/audienceKey/etc) ──────
  const row = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
    .get();
  const existing = row
    ? (JSON.parse(row.value) as Record<string, unknown>)
    : {};
  const nextPatterns = {
    ...existing,
    pmmid: ERSTE_PMMID,
    trafficking: ERSTE_TRAFFICKING,
  };
  console.log(
    "Patterns → install pmmid + trafficking (incl. final_trafficked_url)",
  );
  if (!DRY_RUN) {
    if (row) {
      db.update(config)
        .set({ value: JSON.stringify(nextPatterns) })
        .where(and(eq(config.clientId, clientId), eq(config.key, "patterns")))
        .run();
    } else {
      db.insert(config)
        .values({
          clientId,
          key: "patterns",
          category: "patterns",
          value: JSON.stringify(nextPatterns),
        })
        .run();
    }
  }

  // ── 2. Backfill the scoped MCs ───────────────────────────────────────────
  const audienceList = db
    .select()
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .all();
  const audienceByKey = new Map(audienceList.map((a) => [a.key, a]));
  const topicByKey = new Map(
    db
      .select()
      .from(topics)
      .where(eq(topics.clientId, clientId))
      .all()
      .map((t) => [t.key, t]),
  );

  const rows = db
    .select()
    .from(messages)
    .where(
      and(eq(messages.clientId, clientId), inArray(messages.number, MC_NUMBERS)),
    )
    .all();
  console.log(`Backfill rows: ${rows.length}`);

  let changed = 0;
  for (const m of rows) {
    const aud = audienceByKey.get(m.audience) ?? null;
    const top = topicByKey.get(m.topic) ?? null;

    const pmmid = generatePmmid(
      {
        audience: m.audience,
        topic: m.topic,
        number: m.number,
        variant: m.variant,
        versionNo: Number(m.versionNo ?? 1),
      },
      audienceList,
      [],
      nextPatterns.pmmid,
    );
    const traffic = generateTrafficking(
      {
        number: m.number,
        variant: m.variant,
        audienceKey: m.audience,
        topicKey: m.topic,
        audiences: audienceList,
        pmmid,
        landingUrl: m.landingUrl,
        audience: aud,
        topic: top,
      },
      nextPatterns.trafficking,
    );

    const before = m.pmmid ?? "∅";
    if (
      before !== pmmid ||
      m.utmCd26 !== traffic.utm_cd26 ||
      (m.finalTraffickedUrl ?? "") !== traffic.final_trafficked_url
    ) {
      changed++;
      console.log(
        `  MC${m.number}${m.variant} @ ${m.audience}\n    pmmid: ${before}\n        -> ${pmmid}\n    final: ${traffic.final_trafficked_url}`,
      );
      if (!DRY_RUN) {
        db.update(messages)
          .set({
            pmmid,
            utmCampaign: traffic.utm_campaign,
            utmSource: traffic.utm_source,
            utmMedium: traffic.utm_medium,
            utmContent: traffic.utm_content,
            utmTerm: traffic.utm_term,
            utmCd26: traffic.utm_cd26,
            finalTraffickedUrl: traffic.final_trafficked_url,
          })
          .where(and(eq(messages.clientId, clientId), eq(messages.id, m.id)))
          .run();
      }
    }
  }

  console.log(
    DRY_RUN
      ? `\nDry run complete — ${changed} row(s) WOULD change, nothing written.`
      : `\nDone — ${changed} row(s) updated.`,
  );
}

main();
