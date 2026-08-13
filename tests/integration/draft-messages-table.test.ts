import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages, draftMessages, draftPreviews } from "@/db/schema";
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

function baseDraft(over: Partial<typeof draftMessages.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    template: "html",
    sizes: '["300x250","970x250"]',
    headline: "Test headline",
    ...over,
  };
}

describe("draft_messages + draft_previews tables (migration 0006)", () => {
  it("accepts a draft and fills status/version/timestamp defaults", async () => {
    const [row] = await db.insert(draftMessages).values(baseDraft()).returning();
    expect(row).toMatchObject({
      template: "html",
      sizes: '["300x250","970x250"]',
      renderStatus: "pending",
      renderStartedAt: null,
      promotedMessageId: null,
      version: 1,
    });
    expect(row!.createdAt).toBeTruthy();
    expect(row!.updatedAt).toBeTruthy();
  });

  it("enforces one preview per (client, draft, size)", async () => {
    const [draft] = await db.insert(draftMessages).values(baseDraft()).returning();
    const preview = {
      clientId: erste.id,
      draftId: draft!.id,
      size: "300x250",
      storageKey: "previews/draft-abc.png",
    };
    await db.insert(draftPreviews).values(preview);
    await expect(db.insert(draftPreviews).values(preview)).rejects.toThrow();
    // a different size is a different key — allowed
    await expect(
      db.insert(draftPreviews).values({ ...preview, size: "970x250" }),
    ).resolves.toBeDefined();
  });

  it("cascades preview delete from draft_messages", async () => {
    const [draft] = await db.insert(draftMessages).values(baseDraft()).returning();
    await db.insert(draftPreviews).values({
      clientId: erste.id,
      draftId: draft!.id,
      size: "300x250",
      storageKey: "previews/draft-abc.png",
    });
    await db.delete(draftMessages).where(eq(draftMessages.id, draft!.id));
    const rows = await db.select().from(draftPreviews);
    expect(rows).toHaveLength(0);
  });

  it("cascades delete from clients", async () => {
    const [draft] = await db.insert(draftMessages).values(baseDraft()).returning();
    await db.insert(draftPreviews).values({
      clientId: erste.id,
      draftId: draft!.id,
      size: "300x250",
      storageKey: "previews/draft-abc.png",
    });
    await db.delete(clients).where(eq(clients.id, erste.id));
    expect(await db.select().from(draftMessages)).toHaveLength(0);
    expect(await db.select().from(draftPreviews)).toHaveLength(0);
  });

  it("nulls promoted_message_id when the promoted message is deleted", async () => {
    const [msg] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "VAL_x",
        topic: "topic_one",
      })
      .returning();
    const [draft] = await db
      .insert(draftMessages)
      .values(baseDraft({ promotedMessageId: msg!.id }))
      .returning();
    await db.delete(messages).where(eq(messages.id, msg!.id));
    const [after] = await db
      .select()
      .from(draftMessages)
      .where(eq(draftMessages.id, draft!.id));
    expect(after!.promotedMessageId).toBeNull();
  });
});
