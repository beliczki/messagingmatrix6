import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  auditLog,
  clients,
  config,
  feedExports,
  messages,
  monitoring,
  topics,
} from "@/db/schema";
import { createMessage, getMessage } from "@/lib/entities/messages";
import { listTopics, updateTopic } from "@/lib/entities/topics";
import { listAudiences, updateAudience } from "@/lib/entities/audiences";
import { previewRekey, rekeyDimension } from "@/lib/entities/rekey";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const PATTERNS = {
  topicKey: "{{product}}_{{tag1}}_{{tag4}}",
  audienceKey: "{{product}}_{{strategy}}",
  pmmid: "a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}",
  trafficking: {
    utm_cd26: "{{PMMID}}",
    utm_medium: "display",
    final_trafficked_url: "{{Landing_URL}}?utm_cd26={{utm_cd26}}",
  },
};

async function writePatterns(clientId: number) {
  const value = JSON.stringify(PATTERNS);
  await db
    .insert(config)
    .values({ clientId, key: "patterns", category: "patterns", value })
    .onConflictDoUpdate({ target: [config.clientId, config.key], set: { value } });
}

async function seedAudience(clientId: number, key: string, fields = {}) {
  const [row] = await db
    .insert(audiences)
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "SZA",
      strategy: "pro",
      ...fields,
    })
    .returning();
  return row;
}

async function seedTopic(clientId: number, key: string, fields = {}) {
  const [row] = await db
    .insert(topics)
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "SZA",
      tag1: "beerste",
      tag4: "150e",
      ...fields,
    })
    .returning();
  return row;
}

/** The state the bug leaves behind: tag4 moved, key did not (MC-guard). */
async function driftTopicTag4(clientId: number, topicId: number, tag4: string) {
  const [before] = await db
    .select()
    .from(topics)
    .where(eq(topics.id, topicId));
  const res = await updateTopic(clientId, topicId, before.version, { tag4 });
  expect(res.ok).toBe(true);
  const [after] = await db.select().from(topics).where(eq(topics.id, topicId));
  // Guard held: the key is now stale.
  expect(after.key).toBe(before.key);
  return after;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await writePatterns(erste.id);
});

afterEach(async () => {
  await h.cleanup();
});

describe("topic rekey cascade", () => {
  it("rewrites the key, every MC's topic, PMMID and trafficking", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    for (let i = 0; i < 3; i++) {
      await createMessage(erste.id, {
        audience: "SZA_pro",
        topic: topic.key,
        landingUrl: "https://erste.hu/x",
      });
    }
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const preview = await previewRekey(erste.id, "topic", topic.id);
    expect(preview).not.toBeNull();
    expect(preview!.stale).toBe(true);
    expect(preview!.currentKey).toBe("SZA_beerste_150e");
    expect(preview!.generatedKey).toBe("SZA_beerste_120e");
    expect(preview!.mcCount).toBe(3);
    expect(preview!.blockers).toEqual([]);
    expect(preview!.samplePmmidBefore).toContain("150e");
    expect(preview!.samplePmmidAfter).toContain("120e");

    const res = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version,
      "user-1",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newKey).toBe("SZA_beerste_120e");
    expect(res.messageIds).toHaveLength(3);

    const [topicRow] = await db
      .select()
      .from(topics)
      .where(eq(topics.id, topic.id));
    expect(topicRow.key).toBe("SZA_beerste_120e");
    expect(topicRow.version).toBe(drifted.version + 1);

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.clientId, erste.id));
    for (const m of rows) {
      expect(m.topic).toBe("SZA_beerste_120e");
      expect(m.pmmid).toBe(
        `a_SZA_pro-t_SZA_beerste_120e-m_${m.number}-v_${m.variant}-n_1`,
      );
      // utm_cd26 = {{PMMID}} must agree with the row's own regenerated id, and
      // the final URL is built from that same value.
      expect(m.utmCd26).toBe(m.pmmid);
      expect(m.finalTraffickedUrl).toBe(
        `https://erste.hu/x?utm_cd26=${m.pmmid}`,
      );
      expect(m.version).toBe(2);
    }
  });

  it("writes one audit row per MC plus the topic, so each keeps its history", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    const mc = await createMessage(erste.id, {
      audience: "SZA_pro",
      topic: topic.key,
    });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");
    await rekeyDimension(erste.id, "topic", topic.id, drifted.version, "user-1");

    const mcAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "messages"),
          eq(auditLog.entityId, String(mc.id)),
        ),
      );
    expect(mcAudit).toHaveLength(1);
    expect(mcAudit[0].action).toBe("update");

    const topicAudit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "topics"),
          eq(auditLog.entityId, String(topic.id)),
        ),
      );
    expect(topicAudit).toHaveLength(1);
  });

  it("is a no-op the second time — the key already matches the pattern", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");
    const first = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version,
      null,
    );
    expect(first.ok).toBe(true);

    const [now] = await db.select().from(topics).where(eq(topics.id, topic.id));
    const second = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      now.version,
      null,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("not_stale");
  });

  it("refuses when the generated key is taken by another topic", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await seedTopic(erste.id, "SZA_beerste_120e", { orderIndex: 1 });
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const res = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== "blocked") {
      throw new Error(`expected blocked, got ${res.ok ? "ok" : res.reason}`);
    }
    expect(res.preview.blockers[0].kind).toBe("key_taken");
  });

  it("refuses when the old key already shipped in an uploaded feed", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    await db.insert(feedExports).values({
      clientId: erste.id,
      product: "SZA",
      feedVersion: 4,
      uploadedToAdformAt: "2026-08-01 10:00:00",
      rowCount: 1,
      payloadJson: JSON.stringify([{ ReportingLabel: "t_SZA_beerste_150e" }]),
    });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const res = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== "blocked") {
      throw new Error(`expected blocked, got ${res.ok ? "ok" : res.reason}`);
    }
    expect(res.preview.blockers[0]).toMatchObject({
      kind: "shipped_feed",
      feedVersion: 4,
    });
    // Nothing moved.
    const [row] = await db.select().from(topics).where(eq(topics.id, topic.id));
    expect(row.key).toBe("SZA_beerste_150e");
  });

  it("does not refuse on an export that was never uploaded", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    await db.insert(feedExports).values({
      clientId: erste.id,
      product: "SZA",
      feedVersion: 4,
      rowCount: 1,
      payloadJson: JSON.stringify([{ ReportingLabel: "t_SZA_beerste_150e" }]),
    });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const preview = await previewRekey(erste.id, "topic", topic.id);
    expect(preview!.blockers).toEqual([]);
  });

  it("refuses when a monitoring row already references the old key", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    await db.insert(monitoring).values({
      clientId: erste.id,
      platform: "adform",
      audienceKey: "SZA_pro",
      topicKey: "SZA_beerste_150e",
      mcNumber: 1,
      mcVariant: "a",
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
    });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const res = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== "blocked") {
      throw new Error(`expected blocked, got ${res.ok ? "ok" : res.reason}`);
    }
    expect(res.preview.blockers[0]).toMatchObject({
      kind: "monitoring_rows",
      count: 1,
    });
  });

  it("rejects a stale expected version", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });
    const drifted = await driftTopicTag4(erste.id, topic.id, "120e");

    const res = await rekeyDimension(
      erste.id,
      "topic",
      topic.id,
      drifted.version - 1,
      null,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("version_mismatch");
  });
});

describe("audience rekey cascade", () => {
  it("rewrites the audience key and every MC's audience + PMMID", async () => {
    const aud = await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: aud.key, topic: topic.key });

    const upd = await updateAudience(erste.id, aud.id, aud.version, {
      strategy: "ret",
    });
    expect(upd.ok).toBe(true);
    const [drifted] = await db
      .select()
      .from(audiences)
      .where(eq(audiences.id, aud.id));
    expect(drifted.key).toBe("SZA_pro");

    const res = await rekeyDimension(
      erste.id,
      "audience",
      aud.id,
      drifted.version,
      null,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newKey).toBe("SZA_ret");

    const [m] = await db
      .select()
      .from(messages)
      .where(eq(messages.clientId, erste.id));
    expect(m.audience).toBe("SZA_ret");
    expect(m.pmmid).toContain("a_SZA_ret-");
    expect(m.utmCd26).toBe(m.pmmid);
  });
});

describe("stale-key flag on the list endpoints", () => {
  it("marks a topic whose key no longer matches its pattern", async () => {
    await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: "SZA_pro", topic: topic.key });

    const before = (await listTopics(erste.id)).find((t) => t.id === topic.id)!;
    expect(before.keyStale).toBe(false);
    expect(before.generatedKey).toBe("SZA_beerste_150e");

    await driftTopicTag4(erste.id, topic.id, "120e");
    const after = (await listTopics(erste.id)).find((t) => t.id === topic.id)!;
    expect(after.keyStale).toBe(true);
    expect(after.generatedKey).toBe("SZA_beerste_120e");
    expect(after.key).toBe("SZA_beerste_150e");
  });

  it("marks a stale audience the same way", async () => {
    const aud = await seedAudience(erste.id, "SZA_pro");
    const topic = await seedTopic(erste.id, "SZA_beerste_150e");
    await createMessage(erste.id, { audience: aud.key, topic: topic.key });
    await updateAudience(erste.id, aud.id, aud.version, { strategy: "ret" });

    const row = (await listAudiences(erste.id)).find((a) => a.id === aud.id)!;
    expect(row.keyStale).toBe(true);
    expect(row.generatedKey).toBe("SZA_ret");
  });
});
