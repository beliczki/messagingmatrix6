import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, config, topics } from "@/db/schema";
import {
  archiveTopic,
  createTopic,
  generateTopicKey,
  getTopic,
  listTopics,
  reorderTopics,
  restoreTopic,
  updateTopic,
} from "@/lib/entities/topics";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

async function setPattern(clientId: number, pattern: string) {
  await db.insert(config).values({
    clientId,
    key: "patterns",
    value: JSON.stringify({ topicKey: pattern }),
    category: "patterns",
  });
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("topic key generation", () => {
  it("falls back to top{order+1} when no pattern is set", async () => {
    const t = await createTopic(erste.id, { name: "T1" });
    expect(t.key).toBe("top1");
    const t2 = await createTopic(erste.id, { name: "T2" });
    expect(t2.key).toBe("top2");
  });

  it("uses the per-client pattern when set", async () => {
    await setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = await createTopic(erste.id, {
      name: "Card",
      product: "Loans",
      tag1: "Promo",
    });
    expect(t.key).toBe("loans_promo");
  });

  it("each client has its own pattern", async () => {
    await setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    await setPattern(telekom.id, "{{tag1|upper}}-{{product|upper}}");
    const e = await createTopic(erste.id, { name: "X", product: "A", tag1: "B" });
    const t = await createTopic(telekom.id, { name: "X", product: "A", tag1: "B" });
    expect(e.key).toBe("a_b");
    expect(t.key).toBe("B-A");
  });

  it("regenerates key on update when product/tag1-4 change (and key not explicitly set)", async () => {
    await setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = await createTopic(erste.id, {
      name: "T",
      product: "Loans",
      tag1: "A",
    });
    expect(t.key).toBe("loans_a");

    const r = await updateTopic(erste.id, t.id, 1, { tag1: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.key).toBe("loans_b");
  });

  it("does NOT regenerate when an explicit key is provided in the update", async () => {
    await setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = await createTopic(erste.id, { name: "T", product: "Loans", tag1: "A" });
    const r = await updateTopic(erste.id, t.id, 1, { tag1: "B", key: "manual-key" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.key).toBe("manual-key");
  });

  it("does NOT regenerate when an MC references the current key (frozen)", async () => {
    await setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = await createTopic(erste.id, {
      name: "T",
      product: "Loans",
      tag1: "A",
    });
    expect(t.key).toBe("loans_a");
    // Seed audience + message that references this topic.
    const { audiences } = await import("@/db/schema");
    await db
      .insert(audiences)
      .values({ clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0 });
    const { createMessage } = await import("@/lib/entities/messages");
    await createMessage(erste.id, { audience: "aud1", topic: t.key });

    const r = await updateTopic(erste.id, t.id, 1, { tag1: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Key kept; tag1 still updated.
      expect(r.row.key).toBe("loans_a");
      expect(r.row.tag1).toBe("B");
    }
  });

  it("generateTopicKey() returns the fallback when the pattern evaluates empty", async () => {
    await setPattern(erste.id, "{{nope}}");
    expect(
      await generateTopicKey(
        erste.id,
        { product: null, tag1: null, tag2: null, tag3: null, tag4: null },
        4,
      ),
    ).toBe("top5");
  });
});

describe("topics CRUD client scoping", () => {
  it("topic created for Telekom is invisible to Erste", async () => {
    const e = await createTopic(erste.id, { name: "Erste topic" });
    const t = await createTopic(telekom.id, { name: "Telekom topic" });

    expect((await listTopics(erste.id)).map((r) => r.id)).toEqual([e.id]);
    expect(await getTopic(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found and does not mutate", async () => {
    const t = await createTopic(telekom.id, { name: "Tek" });
    const r = await updateTopic(erste.id, t.id, 1, { name: "hijacked" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect((await getTopic(telekom.id, t.id))?.name).toBe("Tek");
  });

  it("archive with foreign client_id leaves the row unaffected", async () => {
    const t = await createTopic(telekom.id, { name: "Tek" });
    const r = await archiveTopic(erste.id, t.id, 1);
    expect(r.ok).toBe(false);
    expect((await getTopic(telekom.id, t.id))?.archivedAt).toBeNull();
  });

  it("archive soft-deletes (sets archived_at), restore brings it back, list filters by default", async () => {
    const t = await createTopic(erste.id, { name: "T" });
    const ok = await archiveTopic(erste.id, t.id, 1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.cascadedMessageIds).toEqual([]);
    const archived = await getTopic(erste.id, t.id);
    expect(archived?.archivedAt).not.toBeNull();
    expect((await listTopics(erste.id)).map((r) => r.id)).not.toContain(t.id);
    expect(
      (await listTopics(erste.id, { includeArchived: true })).map((r) => r.id),
    ).toContain(t.id);

    const restored = await restoreTopic(erste.id, t.id, archived!.version);
    expect(restored.ok).toBe(true);
    expect((await getTopic(erste.id, t.id))?.archivedAt).toBeNull();
  });
});

describe("topics optimistic locking", () => {
  it("stale version on update returns current row + version", async () => {
    const t = await createTopic(erste.id, { name: "T" });
    const ok = await updateTopic(erste.id, t.id, 1, { name: "T2" });
    expect(ok.ok).toBe(true);
    const stale = await updateTopic(erste.id, t.id, 1, { name: "T3" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });

  it("reorderTopics permutes only within the sent subset's own slots", async () => {
    const a = await createTopic(erste.id, { name: "A" });
    const b = await createTopic(erste.id, { name: "B" });
    const c = await createTopic(erste.id, { name: "C" });
    const d = await createTopic(erste.id, { name: "D" });
    // Send [C, A]: group {A,C} occupies slots {0,2}; B and D never move.
    await reorderTopics(erste.id, [c.id, a.id]);
    const order = (await listTopics(erste.id)).map((r) => r.name);
    expect(order).toEqual(["C", "B", "A", "D"]);
    expect((await getTopic(erste.id, b.id))?.orderIndex).toBe(1);
    expect((await getTopic(erste.id, d.id))?.orderIndex).toBe(3);
  });
});
