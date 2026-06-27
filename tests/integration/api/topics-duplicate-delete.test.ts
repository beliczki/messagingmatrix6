import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages } from "@/db/schema";
import {
  createTopic,
  deleteTopic,
  duplicateTopic,
  getTopic,
  listTopics,
} from "@/lib/entities/topics";
import { createMessage } from "@/lib/entities/messages";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

async function seedAudience(clientId: number, key = "aud1") {
  await db
    .insert(audiences)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0 });
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
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("duplicateTopic", () => {
  it("plain name + key get (1) / _1 suffix", async () => {
    const t = await createTopic(erste.id, { key: "mytop", name: "Bar" });
    const dup = await duplicateTopic(erste.id, t.id);
    expect(dup).not.toBeNull();
    expect(dup?.name).toBe("Bar (1)");
    expect(dup?.key).toBe("mytop_1");
    expect(dup?.id).not.toBe(t.id);
    expect(dup?.version).toBe(1);
  });

  it("existing (n) name increments to (n+1)", async () => {
    await createTopic(erste.id, { key: "k1", name: "Bar" });
    const second = await createTopic(erste.id, { key: "k2", name: "Bar (1)" });
    const dup = await duplicateTopic(erste.id, second.id);
    expect(dup?.name).toBe("Bar (2)");
  });

  it("existing _n key increments to _n+1", async () => {
    await createTopic(erste.id, { key: "base", name: "Base" });
    const second = await createTopic(erste.id, { key: "base_1", name: "Base copy" });
    const dup = await duplicateTopic(erste.id, second.id);
    expect(dup?.key).toBe("base_2");
  });

  it("copies writable fields (product, tags, comment, …)", async () => {
    const t = await createTopic(erste.id, {
      key: "src",
      name: "Src",
      product: "Loans",
      tag: "general",
      tag1: "promo",
      tag2: "march",
      comment: "important",
    });
    const dup = await duplicateTopic(erste.id, t.id);
    expect(dup?.product).toBe("Loans");
    expect(dup?.tag).toBe("general");
    expect(dup?.tag1).toBe("promo");
    expect(dup?.tag2).toBe("march");
    expect(dup?.comment).toBe("important");
  });

  it("source not found → null", async () => {
    expect(await duplicateTopic(erste.id, 99999)).toBeNull();
  });

  it("tenant isolation — Erste cannot duplicate Telekom's topic", async () => {
    const t1 = await createTopic(telekom.id, { key: "t", name: "T" });
    expect(await duplicateTopic(erste.id, t1.id)).toBeNull();
  });
});

describe("deleteTopic", () => {
  it("hard delete works when no messages reference the key", async () => {
    const t = await createTopic(erste.id, { key: "k", name: "K" });
    const result = await deleteTopic(erste.id, t.id, 1);
    expect(result.ok).toBe(true);
    expect(await getTopic(erste.id, t.id)).toBeNull();
    expect(
      (await listTopics(erste.id, { includeArchived: true })).find(
        (r) => r.id === t.id,
      ),
    ).toBeUndefined();
  });

  it("refuses with in_use when a live message references the key", async () => {
    const t = await createTopic(erste.id, { key: "k", name: "K" });
    await seedAudience(erste.id, "aud1");
    const m = await createMessage(erste.id, { audience: "aud1", topic: "k" });
    const result = await deleteTopic(erste.id, t.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "in_use") {
      expect(result.referencedBy).toContain(m.id);
    } else {
      throw new Error("expected in_use refusal");
    }
    expect(await getTopic(erste.id, t.id)).not.toBeNull();
  });

  it("refuses with in_use even when referencing message is archived", async () => {
    const t = await createTopic(erste.id, { key: "k", name: "K" });
    await seedAudience(erste.id, "aud1");
    const m = await createMessage(erste.id, { audience: "aud1", topic: "k" });
    await db
      .update(messages)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(messages.id, m.id));
    const result = await deleteTopic(erste.id, t.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("in_use");
  });

  it("optimistic version mismatch", async () => {
    const t = await createTopic(erste.id, { key: "k", name: "K" });
    const result = await deleteTopic(erste.id, t.id, 99);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "version_mismatch") {
      expect(result.current.id).toBe(t.id);
    } else {
      throw new Error("expected version_mismatch");
    }
  });

  it("not_found", async () => {
    const result = await deleteTopic(erste.id, 99999, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("tenant isolation — Erste cannot delete Telekom's topic", async () => {
    const t1 = await createTopic(telekom.id, { key: "t", name: "T" });
    const result = await deleteTopic(erste.id, t1.id, 1);
    expect(result.ok).toBe(false);
    expect(await getTopic(telekom.id, t1.id)).not.toBeNull();
  });
});
