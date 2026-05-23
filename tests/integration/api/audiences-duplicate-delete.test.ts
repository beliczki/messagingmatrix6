import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, topics, messages } from "@/db/schema";
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

function seedTopic(clientId: number, key = "top1") {
  db.insert(topics)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0 })
    .run();
}

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
  withActiveClientKey("erste");
});

afterEach(() => {
  h.cleanup();
});

describe("duplicateAudience", () => {
  it("plain name + key get (1) / _1 suffix", () => {
    const a = createAudience(erste.id, { key: "myaud", name: "Foo" });
    const dup = duplicateAudience(erste.id, a.id);
    expect(dup).not.toBeNull();
    expect(dup?.name).toBe("Foo (1)");
    expect(dup?.key).toBe("myaud_1");
    expect(dup?.id).not.toBe(a.id);
    expect(dup?.version).toBe(1);
  });

  it("existing (n) name increments to (n+1)", () => {
    createAudience(erste.id, { key: "k1", name: "Foo" });
    const second = createAudience(erste.id, { key: "k2", name: "Foo (1)" });
    const dup = duplicateAudience(erste.id, second.id);
    expect(dup?.name).toBe("Foo (2)");
  });

  it("existing _n key increments to _n+1", () => {
    createAudience(erste.id, { key: "base", name: "Base" });
    const second = createAudience(erste.id, { key: "base_1", name: "Base copy" });
    const dup = duplicateAudience(erste.id, second.id);
    expect(dup?.key).toBe("base_2");
  });

  it("sparse suffix state — _1, _3 exist → next is _4", () => {
    createAudience(erste.id, { key: "x", name: "X" });
    createAudience(erste.id, { key: "x_1", name: "X1" });
    createAudience(erste.id, { key: "x_3", name: "X3" });
    const src = createAudience(erste.id, { key: "x_5", name: "X5" });
    const dup = duplicateAudience(erste.id, src.id);
    expect(dup?.key).toBe("x_6");
  });

  it("copies writable fields (status, product, strategy, …)", () => {
    const a = createAudience(erste.id, {
      key: "src",
      name: "Src",
      product: "Loans",
      strategy: "Prospecting",
      device: "Mobile",
      tag: "v1",
      comment: "hello",
    });
    const dup = duplicateAudience(erste.id, a.id);
    expect(dup?.product).toBe("Loans");
    expect(dup?.strategy).toBe("Prospecting");
    expect(dup?.device).toBe("Mobile");
    expect(dup?.tag).toBe("v1");
    expect(dup?.comment).toBe("hello");
  });

  it("orderIndex is max+1 within the client", () => {
    const a = createAudience(erste.id, { key: "a", name: "A" });
    const b = createAudience(erste.id, { key: "b", name: "B" });
    const dup = duplicateAudience(erste.id, a.id);
    expect(dup?.orderIndex).toBeGreaterThan(b.orderIndex);
  });

  it("source not found → null", () => {
    expect(duplicateAudience(erste.id, 99999)).toBeNull();
  });

  it("tenant isolation — Erste cannot duplicate Telekom's audience", () => {
    const t1 = createAudience(telekom.id, { key: "t", name: "T" });
    expect(duplicateAudience(erste.id, t1.id)).toBeNull();
  });
});

describe("deleteAudience", () => {
  it("hard delete works when no messages reference the key", () => {
    const a = createAudience(erste.id, { key: "k", name: "K" });
    const result = deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(true);
    expect(getAudience(erste.id, a.id)).toBeNull();
    expect(
      listAudiences(erste.id, { includeArchived: true }).find(
        (r) => r.id === a.id,
      ),
    ).toBeUndefined();
  });

  it("refuses with in_use when a live message references the key", () => {
    const a = createAudience(erste.id, { key: "k", name: "K" });
    seedTopic(erste.id, "top1");
    const m = createMessage(erste.id, { audience: "k", topic: "top1" });
    const result = deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "in_use") {
      expect(result.referencedBy).toContain(m.id);
    } else {
      throw new Error("expected in_use refusal");
    }
    expect(getAudience(erste.id, a.id)).not.toBeNull();
  });

  it("refuses with in_use even when the referencing message is archived", () => {
    const a = createAudience(erste.id, { key: "k", name: "K" });
    seedTopic(erste.id, "top1");
    const m = createMessage(erste.id, { audience: "k", topic: "top1" });
    db.update(messages)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(messages.id, m.id))
      .run();
    const result = deleteAudience(erste.id, a.id, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("in_use");
    }
  });

  it("optimistic version mismatch", () => {
    const a = createAudience(erste.id, { key: "k", name: "K" });
    const result = deleteAudience(erste.id, a.id, 99);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "version_mismatch") {
      expect(result.current.id).toBe(a.id);
    } else {
      throw new Error("expected version_mismatch");
    }
  });

  it("not_found", () => {
    const result = deleteAudience(erste.id, 99999, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("tenant isolation — Erste cannot delete Telekom's audience", () => {
    const t1 = createAudience(telekom.id, { key: "t", name: "T" });
    const result = deleteAudience(erste.id, t1.id, 1);
    expect(result.ok).toBe(false);
    expect(getAudience(telekom.id, t1.id)).not.toBeNull();
  });
});

