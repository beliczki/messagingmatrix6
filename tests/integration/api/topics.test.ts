import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, config, topics } from "@/db/schema";
import {
  createTopic,
  deleteTopic,
  generateTopicKey,
  getTopic,
  listTopics,
  updateTopic,
} from "@/lib/entities/topics";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

function setPattern(clientId: number, pattern: string) {
  db.insert(config)
    .values({
      clientId,
      key: "patterns",
      value: JSON.stringify({ topicKey: pattern }),
      category: "patterns",
    })
    .run();
}

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
});

afterEach(() => {
  h.cleanup();
});

describe("topic key generation", () => {
  it("falls back to top{order+1} when no pattern is set", () => {
    const t = createTopic(erste.id, { name: "T1" });
    expect(t.key).toBe("top1");
    const t2 = createTopic(erste.id, { name: "T2" });
    expect(t2.key).toBe("top2");
  });

  it("uses the per-client pattern when set", () => {
    setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = createTopic(erste.id, {
      name: "Card",
      product: "Loans",
      tag1: "Promo",
    });
    expect(t.key).toBe("loans_promo");
  });

  it("each client has its own pattern", () => {
    setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    setPattern(telekom.id, "{{tag1|upper}}-{{product|upper}}");
    const e = createTopic(erste.id, { name: "X", product: "A", tag1: "B" });
    const t = createTopic(telekom.id, { name: "X", product: "A", tag1: "B" });
    expect(e.key).toBe("a_b");
    expect(t.key).toBe("B-A");
  });

  it("regenerates key on update when product/tag1-4 change (and key not explicitly set)", () => {
    setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = createTopic(erste.id, {
      name: "T",
      product: "Loans",
      tag1: "A",
    });
    expect(t.key).toBe("loans_a");

    const r = updateTopic(erste.id, t.id, 1, { tag1: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.key).toBe("loans_b");
  });

  it("does NOT regenerate when an explicit key is provided in the update", () => {
    setPattern(erste.id, "{{product|lower}}_{{tag1|lower}}");
    const t = createTopic(erste.id, { name: "T", product: "Loans", tag1: "A" });
    const r = updateTopic(erste.id, t.id, 1, { tag1: "B", key: "manual-key" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.key).toBe("manual-key");
  });

  it("generateTopicKey() returns the fallback when the pattern evaluates empty", () => {
    setPattern(erste.id, "{{nope}}");
    expect(
      generateTopicKey(
        erste.id,
        { product: null, tag1: null, tag2: null, tag3: null, tag4: null },
        4,
      ),
    ).toBe("top5");
  });
});

describe("topics CRUD client scoping", () => {
  it("topic created for Telekom is invisible to Erste", () => {
    const e = createTopic(erste.id, { name: "Erste topic" });
    const t = createTopic(telekom.id, { name: "Telekom topic" });

    expect(listTopics(erste.id).map((r) => r.id)).toEqual([e.id]);
    expect(getTopic(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found and does not mutate", () => {
    const t = createTopic(telekom.id, { name: "Tek" });
    const r = updateTopic(erste.id, t.id, 1, { name: "hijacked" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect(getTopic(telekom.id, t.id)?.name).toBe("Tek");
  });

  it("delete with foreign client_id leaves the row intact", () => {
    const t = createTopic(telekom.id, { name: "Tek" });
    const r = deleteTopic(erste.id, t.id, 1);
    expect(r.ok).toBe(false);
    expect(getTopic(telekom.id, t.id)).not.toBeNull();
  });
});

describe("topics optimistic locking", () => {
  it("stale version on update returns current row + version", () => {
    const t = createTopic(erste.id, { name: "T" });
    const ok = updateTopic(erste.id, t.id, 1, { name: "T2" });
    expect(ok.ok).toBe(true);
    const stale = updateTopic(erste.id, t.id, 1, { name: "T3" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });
});
