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

async function seedAudience(clientId: number, key: string) {
  const [row] = await db
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
    .returning();
  return row;
}

async function seedTopic(clientId: number, key: string) {
  const [row] = await db
    .insert(topics)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0, product: "Loans" })
    .returning();
  return row;
}

// One source card copied across three audiences → primary + 3 siblings, all
// same (number, variant), each on its own audience.
async function seedCard() {
  await seedAudience(erste.id, "aud1");
  await seedAudience(erste.id, "aud2");
  await seedAudience(erste.id, "aud3");
  await seedAudience(erste.id, "aud4");
  await seedTopic(erste.id, "top1");
  const primary = await createMessage(erste.id, {
    audience: "aud1",
    topic: "top1",
    name: "Card",
    headline: "Original",
    status: "INCOMING",
    startDate: "2026-01-01",
  });
  await copyMessages(erste.id, [primary.pmmid!], ["aud2", "aud3", "aud4"]);
  return (await getMessage(erste.id, primary.id))!;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("findSiblings", () => {
  it("returns the other audience copies of the same (number, variant)", async () => {
    const primary = await seedCard();
    const sibs = await findSiblings(erste.id, primary);
    expect(sibs).toHaveLength(3);
    expect(sibs.every((s) => s.number === primary.number && s.variant === primary.variant)).toBe(true);
    expect(sibs.every((s) => s.id !== primary.id)).toBe(true);
    expect(sibs.map((s) => s.audience).sort()).toEqual(["aud2", "aud3", "aud4"]);
  });

  it("excludes archived siblings", async () => {
    const primary = await seedCard();
    const victim = (await findSiblings(erste.id, primary))[0];
    await db
      .update(messages)
      .set({ archivedAt: "2026-05-01" })
      .where(eq(messages.id, victim.id));
    expect(await findSiblings(erste.id, primary)).toHaveLength(2);
  });
});

describe("propagateToSiblings", () => {
  it("propagates shared creative + status fields to every sibling", async () => {
    const primary = await seedCard();
    const changes = await propagateToSiblings(erste.id, primary, {
      headline: "Updated",
      status: "ACTIVE",
    });
    expect(changes).toHaveLength(3);
    for (const sib of await findSiblings(erste.id, primary)) {
      expect(sib.headline).toBe("Updated");
      expect(sib.status).toBe("ACTIVE");
    }
  });

  it("syncs flight dates to siblings, never overwrites audience/topic", async () => {
    const primary = await seedCard();
    const before = await findSiblings(erste.id, primary);
    await propagateToSiblings(erste.id, primary, {
      headline: "Updated",
      // flight dates are campaign-level → propagate
      startDate: "2099-12-31",
      endDate: "2099-12-31",
      // cell-defining placement — must be ignored even if present in the payload
      audience: "aud1",
      topic: "top1",
    } as never);
    const after = await findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.headline).toBe("Updated"); // shared field changed
      expect(sib.startDate).toBe("2099-12-31"); // dates sync
      expect(sib.endDate).toBe("2099-12-31");
      expect(sib.audience).toBe(orig.audience); // placement untouched
      expect(sib.topic).toBe(orig.topic);
    }
  });

  it("bumps each sibling's optimistic-lock version", async () => {
    const primary = await seedCard();
    const before = await findSiblings(erste.id, primary);
    await propagateToSiblings(erste.id, primary, { headline: "Updated" });
    const after = await findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.version).toBe(orig.version + 1);
    }
  });

  it("is a no-op when the payload has no shared fields", async () => {
    const primary = await seedCard();
    const before = await findSiblings(erste.id, primary);
    // Only cell-defining placement fields → nothing to propagate.
    const changes = await propagateToSiblings(erste.id, primary, {
      audience: "aud2",
      topic: "top1",
    } as never);
    expect(changes).toHaveLength(0);
    const after = await findSiblings(erste.id, primary);
    for (const sib of after) {
      const orig = before.find((b) => b.id === sib.id)!;
      expect(sib.version).toBe(orig.version); // untouched
    }
  });
});
