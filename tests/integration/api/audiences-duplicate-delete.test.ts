import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, topics, messages } from "@/db/schema";
import {
  createAudience,
  deleteAudience,
  duplicateAudience,
  getAudience,
  listAudiences,
} from "@/lib/entities/audiences";
import { createMessage } from "@/lib/entities/messages";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

async function seedTopic(clientId: number, key = "top1") {
  await db
    .insert(topics)
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

describe("duplicateAudience", () => {
  it("plain name + key get (1) / _1 suffix", async () => {
    const a = await createAudience(erste.id, { key: "myaud", name: "Foo" });
    const dup = await duplicateAudience(erste.id, a.id);
    expect(dup).not.toBeNull();
    expect(dup?.name).toBe("Foo (1)");
    expect(dup?.key).toBe("myaud_1");
    expect(dup?.id).not.toBe(a.id);
    expect(dup?.version).toBe(1);
  });

  it("existing (n) name increments to (n+1)", async () => {
    await createAudience(erste.id, { key: "k1", name: "Foo" });
    const second = await createAudience(erste.id, { key: "k2", name: "Foo (1)" });
    const dup = await duplicateAudience(erste.id, second.id);
    expect(dup?.name).toBe("Foo (2)");
  });

  it("existing _n key increments to _n+1", async () => {
    await createAudience(erste.id, { key: "base", name: "Base" });
    const second = await createAudience(erste.id, { key: "base_1", name: "Base copy" });
    const dup = await duplicateAudience(erste.id, second.id);
    expect(dup?.key).toBe("base_2");
  });

  it("sparse suffix state — _1, _3 exist → next is _4", async () => {
    await createAudience(erste.id, { key: "x", name: "X" });
    await createAudience(erste.id, { key: "x_1", name: "X1" });
    await createAudience(erste.id, { key: "x_3", name: "X3" });
    const src = await createAudience(erste.id, { key: "x_5", name: "X5" });
    const dup = await duplicateAudience(erste.id, src.id);
    expect(dup?.key).toBe("x_6");
  });

  it("copies writable fields (status, product, strategy, …)", async () => {
    const a = await createAudience(erste.id, {
      key: "src",
      name: "Src",
      product: "Loans",
      strategy: "Prospecting",
      device: "Mobile",
      tag: "v1",
      comment: "hello",
    });
    const dup = await duplicateAudience(erste.id, a.id);
    expect(dup?.product).toBe("Loans");
    expect(dup?.strategy).toBe("Prospecting");
    expect(dup?.device).toBe("Mobile");
    expect(dup?.tag).toBe("v1");
    expect(dup?.comment).toBe("hello");
  });

  it("orderIndex is max+1 within the client", async () => {
    const a = await createAudience(erste.id, { key: "a", name: "A" });
    const b = await createAudience(erste.id, { key: "b", name: "B" });
    const dup = await duplicateAudience(erste.id, a.id);
    expect(dup?.orderIndex).toBeGreaterThan(b.orderIndex);
  });

  it("source not found → null", async () => {
    expect(await duplicateAudience(erste.id, 99999)).toBeNull();
  });

  it("tenant isolation — Erste cannot duplicate Telekom's audience", async () => {
    const t1 = await createAudience(telekom.id, { key: "t", name: "T" });
    expect(await duplicateAudience(erste.id, t1.id)).toBeNull();
  });
});

describe("deleteAudience", () => {
  it("hard delete works when no messages reference the key", async () => {
    const a = await createAudience(erste.id, { key: "k", name: "K" });
    const result = await deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(true);
    expect(await getAudience(erste.id, a.id)).toBeNull();
    expect(
      (await listAudiences(erste.id, { includeArchived: true })).find(
        (r) => r.id === a.id,
      ),
    ).toBeUndefined();
  });

  it("refuses with in_use when a live message references the key", async () => {
    const a = await createAudience(erste.id, { key: "k", name: "K" });
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: "k", topic: "top1" });
    const result = await deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "in_use") {
      // referencedBy carries enough detail for the UI to name the blockers.
      expect(result.referencedBy.map((r) => r.id)).toContain(m.id);
      const blocker = result.referencedBy.find((r) => r.id === m.id)!;
      expect(blocker.number).toBe(m.number);
      expect(blocker.variant).toBe(m.variant);
    } else {
      throw new Error("expected in_use refusal");
    }
    expect(await getAudience(erste.id, a.id)).not.toBeNull();
  });

  it("refuses with in_use even when the referencing message is archived", async () => {
    const a = await createAudience(erste.id, { key: "k", name: "K" });
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: "k", topic: "top1" });
    await db
      .update(messages)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(messages.id, m.id));
    const result = await deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("in_use");
    }
  });

  it("optimistic version mismatch", async () => {
    const a = await createAudience(erste.id, { key: "k", name: "K" });
    const result = await deleteAudience(erste.id, a.id, 99);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "version_mismatch") {
      expect(result.current.id).toBe(a.id);
    } else {
      throw new Error("expected version_mismatch");
    }
  });

  it("not_found", async () => {
    const result = await deleteAudience(erste.id, 99999, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("tenant isolation — Erste cannot delete Telekom's audience", async () => {
    const t1 = await createAudience(telekom.id, { key: "t", name: "T" });
    const result = await deleteAudience(erste.id, t1.id, 1);
    expect(result.ok).toBe(false);
    expect(await getAudience(telekom.id, t1.id)).not.toBeNull();
  });
});
