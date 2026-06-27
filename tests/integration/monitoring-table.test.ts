import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages, monitoring } from "@/db/schema";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };

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

function baseRow(over: Partial<typeof monitoring.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    platform: "adform",
    scope: "p_adform",
    pmmid: "p_adform-s_pro-a_VAL_x-m_1-t_topic_one-v_a-n_1",
    audienceKey: "VAL_x",
    topicKey: "topic_one",
    mcNumber: 1,
    mcVariant: "a",
    impressions: 100,
    clicks: 2,
    cost: 12.5,
    conversions: 1,
    ctr: 0.02,
    periodFrom: "01/04/2026 00:00:00",
    periodTo: "30/04/2026 23:59:59",
    sourceFilename: "Creative rep_04_2026.xlsx",
    ...over,
  };
}

describe("monitoring table (migration 0017)", () => {
  it("accepts a row and stores aggregated metrics", async () => {
    await db.insert(monitoring).values(baseRow());
    const [row] = await db
      .select()
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id))
      .limit(1);
    expect(row).toMatchObject({ platform: "adform", impressions: 100, cost: 12.5 });
    expect(row!.importedAt).toBeTruthy(); // CURRENT_TIMESTAMP default
  });

  it("enforces one row per (platform, period, message-key)", async () => {
    await db.insert(monitoring).values(baseRow());
    await expect(db.insert(monitoring).values(baseRow())).rejects.toThrow();
    // a different variant is a different key — allowed
    await expect(
      db.insert(monitoring).values(baseRow({ mcVariant: "b" })),
    ).resolves.toBeDefined();
  });

  it("nulls messageId when the linked message is deleted (set null)", async () => {
    const [msg] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 1, variant: "a", audience: "VAL_x", topic: "topic_one" })
      .returning();
    await db.insert(monitoring).values(baseRow({ messageId: msg.id }));

    await db.delete(messages).where(eq(messages.id, msg.id));
    const [row] = await db
      .select()
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id))
      .limit(1);
    expect(row!.messageId).toBeNull();
  });

  it("cascades delete from clients", async () => {
    await db.insert(monitoring).values(baseRow());
    await db.delete(clients).where(eq(clients.id, erste.id));
    const rows = await db.select().from(monitoring);
    expect(rows).toHaveLength(0);
  });
});
