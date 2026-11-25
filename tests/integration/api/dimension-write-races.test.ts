// Writers that race on one topic or audience row. Each test fixes the order
// with a held row lock (tests/helpers/row-lock.ts): the writer under test has
// read the row and reached its UPDATE, a rekey lands and commits, then the
// writer resumes.
//
// The mechanism under test: the writer checks If-Match on a row it read
// without a lock, then writes by id alone. Whatever committed in between is
// overwritten, or the writer goes on acting on the key it read. The contract
// (REBUILD_SPEC §4, §8.2): two writes with the same If-Match, one wins and the
// other gets a 409 with the current row.
//
// Expected keys are the client's key patterns worked out by hand:
//   topicKey    {{product}}_{{tag1}}_{{tag4}}  SZA, beerste, 120e → SZA_beerste_120e
//   audienceKey {{product}}_{{strategy}}       SZA, ret           → SZA_ret
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  auditLog,
  clients,
  config,
  messages,
  topics,
} from "@/db/schema";
import { createMessage } from "@/lib/entities/messages";
import { archiveTopic, getTopic, updateTopic } from "@/lib/entities/topics";
import {
  archiveAudience,
  getAudience,
  updateAudience,
} from "@/lib/entities/audiences";
import { rekeyDimension } from "@/lib/entities/rekey";
import { createTestDb, type TestDb } from "../../helpers/test-db";
import { holdRowLock, waitForLockWaiter } from "../../helpers/row-lock";

let h: TestDb;
let erste: { id: number };

const PATTERNS = {
  topicKey: "{{product}}_{{tag1}}_{{tag4}}",
  audienceKey: "{{product}}_{{strategy}}",
  pmmid: "a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}",
  trafficking: {
    utm_cd26: "{{PMMID}}",
    final_trafficked_url: "{{Landing_URL}}?utm_cd26={{utm_cd26}}",
  },
};
const LP = "https://erste.hu/lp";

const OLD_TOPIC_KEY = "SZA_beerste_150e";
const NEW_TOPIC_KEY = "SZA_beerste_120e";
const OLD_AUDIENCE_KEY = "SZA_pro";
const NEW_AUDIENCE_KEY = "SZA_ret";

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await db.insert(config).values({
    clientId: erste.id,
    key: "patterns",
    category: "patterns",
    value: JSON.stringify(PATTERNS),
  });
});

afterEach(async () => {
  await h.cleanup();
});

/**
 * One audience, one topic, two MCs on them. Then one dimension's key field
 * moves while MCs reference it, so the MC-guard keeps the old key: the row is
 * stale and a rekey has work to do.
 */
async function seedStale(dimension: "topic" | "audience") {
  const [audience] = await db
    .insert(audiences)
    .values({
      clientId: erste.id,
      key: OLD_AUDIENCE_KEY,
      name: "AUD",
      orderIndex: 0,
      product: "SZA",
      strategy: "pro",
    })
    .returning();
  const [topic] = await db
    .insert(topics)
    .values({
      clientId: erste.id,
      key: OLD_TOPIC_KEY,
      name: "TOP",
      orderIndex: 0,
      product: "SZA",
      tag1: "beerste",
      tag4: "150e",
    })
    .returning();
  for (let i = 0; i < 2; i++) {
    await createMessage(erste.id, {
      audience: audience.key,
      topic: topic.key,
      landingUrl: LP,
    });
  }
  if (dimension === "topic") {
    const res = await updateTopic(erste.id, topic.id, topic.version, { tag4: "120e" });
    if (!res.ok) throw new Error("seed: tag4 drift was refused");
    expect(res.row.key).toBe(OLD_TOPIC_KEY);
    return res.row;
  }
  const res = await updateAudience(erste.id, audience.id, audience.version, {
    strategy: "ret",
  });
  if (!res.ok) throw new Error("seed: strategy drift was refused");
  expect(res.row.key).toBe(OLD_AUDIENCE_KEY);
  return res.row;
}

const allMessages = () =>
  db.select().from(messages).where(eq(messages.clientId, erste.id));

async function auditRows(entityType: "topics" | "audiences" | "messages", id: number) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, String(id))));
}

describe("topic PATCH vs rekey — the PATCH does not write the old key back", () => {
  it("the PATCH that waited for the row gets a 409 and every MC still has a topic", async () => {
    const topic = await seedStale("topic");
    const lock = await holdRowLock(topic.id, "topics");
    const patch = updateTopic(erste.id, topic.id, topic.version, { name: "Renamed" });
    await waitForLockWaiter();
    await lock.release(async () => {
      const rekey = await rekeyDimension(erste.id, "topic", topic.id, topic.version, null);
      expect(rekey.ok).toBe(true);
    });

    const res = await patch;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current?.version).toBe(topic.version + 1);
      expect(res.current?.key).toBe(NEW_TOPIC_KEY);
    }
    const after = (await getTopic(erste.id, topic.id))!;
    expect(after.key).toBe(NEW_TOPIC_KEY);
    expect(after.name).toBe("TOP");
    expect(after.version).toBe(topic.version + 1);
    const mcs = await allMessages();
    expect(mcs).toHaveLength(2);
    for (const m of mcs) expect(m.topic).toBe(after.key);
  });
});

describe("audience PATCH vs rekey — the PATCH does not write the old key back", () => {
  it("the PATCH that waited for the row gets a 409 and every MC still has an audience", async () => {
    const audience = await seedStale("audience");
    const lock = await holdRowLock(audience.id, "audiences");
    const patch = updateAudience(erste.id, audience.id, audience.version, {
      name: "Renamed",
    });
    await waitForLockWaiter();
    await lock.release(async () => {
      const rekey = await rekeyDimension(
        erste.id,
        "audience",
        audience.id,
        audience.version,
        null,
      );
      expect(rekey.ok).toBe(true);
    });

    const res = await patch;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current?.version).toBe(audience.version + 1);
      expect(res.current?.key).toBe(NEW_AUDIENCE_KEY);
    }
    const after = (await getAudience(erste.id, audience.id))!;
    expect(after.key).toBe(NEW_AUDIENCE_KEY);
    expect(after.name).toBe("AUD");
    expect(after.version).toBe(audience.version + 1);
    const mcs = await allMessages();
    expect(mcs).toHaveLength(2);
    for (const m of mcs) expect(m.audience).toBe(after.key);
  });
});

describe("two rekeys of one topic — exactly one applies", () => {
  it("the rekey that waited gets version_mismatch and writes nothing", async () => {
    const topic = await seedStale("topic");
    const mcsBefore = await allMessages();
    const lock = await holdRowLock(topic.id, "topics");
    const late = rekeyDimension(erste.id, "topic", topic.id, topic.version, null);
    await waitForLockWaiter();
    await lock.release(async () => {
      const first = await rekeyDimension(erste.id, "topic", topic.id, topic.version, null);
      expect(first.ok).toBe(true);
    });

    const res = await late;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_mismatch");
      if (res.reason === "version_mismatch") {
        expect(res.current.version).toBe(topic.version + 1);
        expect(res.current.key).toBe(NEW_TOPIC_KEY);
      }
    }
    const after = (await getTopic(erste.id, topic.id))!;
    expect(after.key).toBe(NEW_TOPIC_KEY);
    expect(after.version).toBe(topic.version + 1);
    // One audit row for the topic, its `before` the row the winner replaced.
    const topicAudit = await auditRows("topics", topic.id);
    expect(topicAudit).toHaveLength(1);
    expect(JSON.parse(topicAudit[0].before!).key).toBe(OLD_TOPIC_KEY);
    // Each MC moved once: one audit row, one step of the save counter.
    for (const before of mcsBefore) {
      expect(await auditRows("messages", before.id)).toHaveLength(1);
    }
    for (const m of await allMessages()) {
      const before = mcsBefore.find((b) => b.id === m.id)!;
      expect(m.version).toBe(before.version + 1);
      expect(m.topic).toBe(NEW_TOPIC_KEY);
    }
  });
});

describe("archive vs rekey — an archived dimension leaves no live MC behind", () => {
  it("topic: the archive that waited gets a 409; retried, it archives the MCs on the new key", async () => {
    const topic = await seedStale("topic");
    const lock = await holdRowLock(topic.id, "topics");
    const archive = archiveTopic(erste.id, topic.id, topic.version);
    await waitForLockWaiter();
    await lock.release(async () => {
      const rekey = await rekeyDimension(erste.id, "topic", topic.id, topic.version, null);
      expect(rekey.ok).toBe(true);
    });

    const res = await archive;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.current?.version).toBe(topic.version + 1);
    const after = (await getTopic(erste.id, topic.id))!;
    expect(after.archivedAt).toBeNull();
    for (const m of await allMessages()) expect(m.archivedAt).toBeNull();

    // The user's retry with the current version archives the topic and its MCs.
    const retry = await archiveTopic(erste.id, topic.id, after.version);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.cascadedMessageIds).toHaveLength(2);
    for (const m of await allMessages()) expect(m.archivedAt).not.toBeNull();
  });

  it("audience: the archive that waited gets a 409; retried, it archives the MCs on the new key", async () => {
    const audience = await seedStale("audience");
    const lock = await holdRowLock(audience.id, "audiences");
    const archive = archiveAudience(erste.id, audience.id, audience.version);
    await waitForLockWaiter();
    await lock.release(async () => {
      const rekey = await rekeyDimension(
        erste.id,
        "audience",
        audience.id,
        audience.version,
        null,
      );
      expect(rekey.ok).toBe(true);
    });

    const res = await archive;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.current?.version).toBe(audience.version + 1);
    const after = (await getAudience(erste.id, audience.id))!;
    expect(after.archivedAt).toBeNull();
    for (const m of await allMessages()) expect(m.archivedAt).toBeNull();

    const retry = await archiveAudience(erste.id, audience.id, after.version);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.cascadedMessageIds).toHaveLength(2);
    for (const m of await allMessages()) expect(m.archivedAt).not.toBeNull();
  });
});
