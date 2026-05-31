import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages, topics } from "@/db/schema";
import {
  copyMessages,
  createMessage,
  findSiblings,
  getMessage,
  propagateToSiblings,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

function seedAudience(clientId: number, key: string) {
  return db
    .insert(audiences)
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
      strategy: "Prospecting",
      device: "Mobile",
    })
    .returning()
    .get();
}

function seedTopic(clientId: number, key: string) {
  return db
    .insert(topics)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0, product: "Loans" })
    .returning()
    .get();
}

// One source card copied across three audiences → primary + 3 siblings, all
// same (number, variant), each on its own audience.
function seedCard() {
  seedAudience(erste.id, "aud1");
  seedAudience(erste.id, "aud2");
  seedAudience(erste.id, "aud3");
  seedAudience(erste.id, "aud4");
  seedTopic(erste.id, "top1");
  const primary = createMessage(erste.id, {
    audience: "aud1",
    topic: "top1",
    name: "Card",
    headline: "Original",
    status: "INCOMING",
    startDate: "2026-01-01",
  });
  copyMessages(erste.id, [primary.pmmid!], ["aud2", "aud3", "aud4"]);
  return getMessage(erste.id, primary.id)!;
}

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
});

afterEach(() => {
  h.cleanup();
});

describe("findSiblings", () => {
  it("returns the other audience copies of the same (number, variant)", () => {
    const primary = seedCard();
    const sibs = findSiblings(erste.id, primary);
    expect(sibs).toHaveLength(3);
    expect(sibs.every((s) => s.number === primary.number && s.variant === primary.variant)).toBe(true);
    expect(sibs.every((s) => s.id !== primary.id)).toBe(true);
    expect(sibs.map((s) => s.audience).sort()).toEqual(["aud2", "aud3", "aud4"]);
  });

  it("excludes archived siblings", () => {
    const primary = seedCard();
    const victim = findSiblings(erste.id, primary)[0];
    db.update(messages)
      .set({ archivedAt: "2026-05-01" })
      .where(eq(messages.id, victim.id))
      .run();
    expect(findSiblings(erste.id, primary)).toHaveLength(2);
  });
});

describe("propagateToSiblings", () => {
  it("propagates shared creative + status fields to every sibling", () => {
    const primary = seedCard();
    const changes = propagateToSiblings(erste.id, primary, {
      headline: "Updated",
      status: "ACTIVE",
    });
    expect(changes).toHaveLength(3);
    for (const sib of findSiblings(erste.id, primary)) {
      expect(sib.headline).toBe("Updated");
      expect(sib.status).toBe("ACTIVE");
    }
  });

  it("never overwrites a sibling's placement fields (audience/topic/dates)", () => {
    const primary = seedCard();
    const before = findSiblings(erste.id, primary);
    propagateToSiblings(erste.id, primary, {
      headline: "Updated",
      // placement fields — must be ignored even if present in the payload
      audience: "aud1",
      topic: "top1",
      startDate: "2099-12-31",
      endDate: "2099-12-31",
    } as never);
    const after = findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.headline).toBe("Updated"); // shared field changed
      expect(sib.audience).toBe(orig.audience); // placement untouched
      expect(sib.startDate).toBe(orig.startDate);
      expect(sib.endDate).toBe(orig.endDate);
    }
  });

  it("bumps each sibling's optimistic-lock version", () => {
    const primary = seedCard();
    const before = findSiblings(erste.id, primary);
    propagateToSiblings(erste.id, primary, { headline: "Updated" });
    const after = findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.version).toBe(orig.version + 1);
    }
  });

  it("is a no-op when the payload has no shared fields", () => {
    const primary = seedCard();
    const before = findSiblings(erste.id, primary);
    const changes = propagateToSiblings(erste.id, primary, {
      audience: "aud2",
      startDate: "2030-01-01",
    } as never);
    expect(changes).toHaveLength(0);
    const after = findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.version).toBe(orig.version); // untouched
    }
  });
});
