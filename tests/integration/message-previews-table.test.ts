import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages, messagePreviews } from "@/db/schema";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let msg: { id: number; version: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [msg] = await db
    .insert(messages)
    .values({ clientId: erste.id, number: 1, variant: "a", audience: "VAL_x", topic: "topic_one" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

function baseRow(over: Partial<typeof messagePreviews.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    messageId: msg.id,
    size: "300x250",
    storageKey: "previews/abc123.png",
    messageVersion: msg.version,
    ...over,
  };
}

describe("message_previews table (migration 0001)", () => {
  it("accepts a row and fills timestamp defaults", async () => {
    await db.insert(messagePreviews).values(baseRow());
    const [row] = await db
      .select()
      .from(messagePreviews)
      .where(eq(messagePreviews.messageId, msg.id))
      .limit(1);
    expect(row).toMatchObject({
      size: "300x250",
      storageKey: "previews/abc123.png",
      messageVersion: 1,
    });
    expect(row!.createdAt).toBeTruthy();
    expect(row!.updatedAt).toBeTruthy();
  });

  it("enforces one preview per (client, message, size)", async () => {
    await db.insert(messagePreviews).values(baseRow());
    await expect(db.insert(messagePreviews).values(baseRow())).rejects.toThrow();
    // a different size is a different key — allowed
    await expect(
      db.insert(messagePreviews).values(baseRow({ size: "970x250" })),
    ).resolves.toBeDefined();
  });

  it("flags staleness via message_version mismatch after an edit", async () => {
    await db.insert(messagePreviews).values(baseRow());
    // simulate an edit: the optimistic-lock version bumps
    await db
      .update(messages)
      .set({ version: msg.version + 1 })
      .where(eq(messages.id, msg.id));

    const stale = await db
      .select()
      .from(messagePreviews)
      .innerJoin(messages, eq(messagePreviews.messageId, messages.id))
      .where(
        and(
          eq(messagePreviews.messageId, msg.id),
          ne(messagePreviews.messageVersion, messages.version),
        ),
      );
    expect(stale).toHaveLength(1);
  });

  it("cascades delete from messages", async () => {
    await db.insert(messagePreviews).values(baseRow());
    await db.delete(messages).where(eq(messages.id, msg.id));
    const rows = await db.select().from(messagePreviews);
    expect(rows).toHaveLength(0);
  });

  it("cascades delete from clients", async () => {
    await db.insert(messagePreviews).values(baseRow());
    await db.delete(clients).where(eq(clients.id, erste.id));
    const rows = await db.select().from(messagePreviews);
    expect(rows).toHaveLength(0);
  });
});
