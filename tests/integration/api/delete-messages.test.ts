import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  clients,
  creatives,
  messagePreviews,
  messages,
  topics,
} from "@/db/schema";
import {
  archiveMessages,
  createMessage,
  deleteMessages,
  getMessage,
  listMessages,
  updateMessage,
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
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
    })
    .returning();
  return row;
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

describe("archiveMessages", () => {
  it("soft-deletes the batch: archived_at set, version bumped, rows still readable", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    const b = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "B",
    });

    const result = await archiveMessages(erste.id, [
      { mcLabel: a.pmmid!, expectedVersion: a.version },
      { mcLabel: b.pmmid!, expectedVersion: b.version },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.archivedAt).not.toBeNull();
      expect(row.version).toBe(2);
    }
    // Row survives — archive is restorable, unlike a purge.
    expect(await getMessage(erste.id, a.id)).not.toBeNull();
  });

  it("archives a measured (ACTIVE) row — the status lock is delete-only", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    const live = await updateMessage(erste.id, a.id, a.version, {
      status: "ACTIVE",
    });
    expect(live.ok).toBe(true);
    if (!live.ok) return;

    const result = await archiveMessages(erste.id, [
      { mcLabel: live.row.pmmid!, expectedVersion: live.row.version },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects the whole batch on a version conflict — nothing is written", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    const b = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "B",
    });

    const result = await archiveMessages(erste.id, [
      { mcLabel: a.pmmid!, expectedVersion: a.version },
      { mcLabel: b.pmmid!, expectedVersion: b.version + 5 },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("version_conflict");
    expect((await getMessage(erste.id, a.id))!.archivedAt).toBeNull();
  });
});

describe("deleteMessages", () => {
  it("hard-deletes the rows and cascades their preview rows", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: a.id,
      size: "300x250",
      storageKey: "previews/a-300x250.png",
      messageVersion: a.version,
    });

    const result = await deleteMessages(erste.id, [
      { mcLabel: a.pmmid!, expectedVersion: a.version },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1); // pre-delete snapshot, for the audit log
    expect(await getMessage(erste.id, a.id)).toBeNull();
    expect(await listMessages(erste.id)).toHaveLength(0);
    expect(await db.select().from(messagePreviews)).toHaveLength(0);
  });

  it("refuses a measurement-locked row and leaves it in place", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    const live = await updateMessage(erste.id, a.id, a.version, {
      status: "ACTIVE",
    });
    expect(live.ok).toBe(true);
    if (!live.ok) return;

    const result = await deleteMessages(erste.id, [
      { mcLabel: live.row.pmmid!, expectedVersion: live.row.version },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("row_locked_by_status");
    expect(result.status).toBe("ACTIVE");
    expect(await getMessage(erste.id, a.id)).not.toBeNull();
  });

  it("refuses to delete the last carrier of a creative-linked (number, variant)", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "banner_300x250.jpg",
      mcNumber: a.number,
      mcVariant: a.variant,
    });

    const result = await deleteMessages(erste.id, [
      { mcLabel: a.pmmid!, expectedVersion: a.version },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("creative_linked");
    expect(result.creativeCount).toBe(1);
    expect(await getMessage(erste.id, a.id)).not.toBeNull();
  });

  it("allows the delete while another audience copy still carries the number", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "A",
    });
    const copy = await createMessage(erste.id, {
      audience: "aud2",
      topic: "top1",
      name: "A copy",
    });
    // Same card in two audiences: force the copy onto a's (number, variant).
    await db
      .update(messages)
      .set({ number: a.number, variant: a.variant })
      .where(eq(messages.id, copy.id));
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "banner_300x250.jpg",
      mcNumber: a.number,
      mcVariant: a.variant,
    });

    const result = await deleteMessages(erste.id, [
      { mcLabel: a.pmmid!, expectedVersion: a.version },
    ]);
    expect(result.ok).toBe(true);
    expect(await getMessage(erste.id, a.id)).toBeNull();
    expect(await getMessage(erste.id, copy.id)).not.toBeNull();
  });
});
