import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages, topics } from "@/db/schema";
import {
  archiveMessage,
  createMessage,
  getMessage,
  listMessages,
  MessageError,
  updateMessage,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

async function seedAudienceAndTopic(
  clientId: number,
  audKey = "aud1",
  topKey = "top1",
) {
  const [a] = await db
    .insert(audiences)
    .values({
      clientId,
      key: audKey,
      name: audKey.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
      strategy: "Prospecting",
      device: "Mobile",
    })
    .returning();
  const [t] = await db
    .insert(topics)
    .values({
      clientId,
      key: topKey,
      name: topKey.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
    })
    .returning();
  return { a, t };
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
});

afterEach(async () => {
  await h.cleanup();
});

describe("messages — numbering on create", () => {
  it("first message in empty matrix gets #1a v1", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(m.number).toBe(1);
    expect(m.variant).toBe("a");
    expect(m.versionNo).toBe(1);
  });

  it("second message in same cell gets next variant (b)", async () => {
    await seedAudienceAndTopic(erste.id);
    const a = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(a.variant).toBe("a");
    expect(b.variant).toBe("b");
    expect(b.number).toBe(a.number);
  });

  it("message in a different cell gets the next free number", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const m = await createMessage(erste.id, { topic: "top2", audience: "aud2" });
    expect(m.number).toBe(2);
    expect(m.variant).toBe("a");
  });

  it("PMMID is auto-filled from the hardcoded format when no pattern is set", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(m.pmmid).toBe("a_aud1-t_top1-m_1-v_a-n_1");
  });

  it("create rejects unknown audience or topic", async () => {
    await seedAudienceAndTopic(erste.id);
    await expect(
      createMessage(erste.id, { topic: "top1", audience: "ghost" }),
    ).rejects.toThrow(MessageError);
    await expect(
      createMessage(erste.id, { topic: "ghost", audience: "aud1" }),
    ).rejects.toThrow(MessageError);
  });

  it("requestedNumber claims a free number in an empty cell", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 42 },
    );
    expect(m.number).toBe(42);
    expect(m.variant).toBe("a");
    expect(m.pmmid).toBe("a_aud1-t_top1-m_42-v_a-n_1");
    // auto-assign continues from the global max
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    const next = await createMessage(erste.id, { topic: "top2", audience: "aud2" });
    expect(next.number).toBe(43);
  });

  it("requestedNumber rejects a number any live MC already uses", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1
    await expect(
      createMessage(
        erste.id,
        { topic: "top2", audience: "aud2" },
        { requestedNumber: 1 },
      ),
    ).rejects.toThrow(/already in use/);
  });

  it("requestedNumber matching an occupied cell's number adds the next variant", async () => {
    await seedAudienceAndTopic(erste.id);
    const a = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: a.number },
    );
    expect(b.number).toBe(a.number);
    expect(b.variant).toBe("b");
  });

  it("requestedNumber differing from an occupied cell's number is rejected", async () => {
    await seedAudienceAndTopic(erste.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud1" },
        { requestedNumber: 7 },
      ),
    ).rejects.toThrow(/already holds MC1/);
  });
});

describe("messages — cascade archive + parent-first restore", () => {
  it("archiving an audience cascades to all its messages", async () => {
    const { archiveAudience } = await import("@/lib/entities/audiences");
    await seedAudienceAndTopic(erste.id);
    const m1 = await createMessage(erste.id, {
      topic: "top1",
      audience: "aud1",
      name: "M1",
    });
    const m2 = await createMessage(erste.id, {
      topic: "top1",
      audience: "aud1",
      name: "M2",
    });

    const [aud] = await db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .limit(1);
    const r = await archiveAudience(erste.id, aud!.id, aud!.version);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cascadedMessageIds.sort()).toEqual([m1.id, m2.id].sort());
    }

    expect((await getMessage(erste.id, m1.id))?.archivedAt).not.toBeNull();
    expect((await getMessage(erste.id, m2.id))?.archivedAt).not.toBeNull();
    // listMessages default filter excludes archived rows.
    expect(await listMessages(erste.id)).toHaveLength(0);
  });

  it("archiving a topic cascades to all its messages", async () => {
    const { archiveTopic } = await import("@/lib/entities/topics");
    await seedAudienceAndTopic(erste.id);
    const m1 = await createMessage(erste.id, {
      topic: "top1",
      audience: "aud1",
      name: "M1",
    });

    const [topic] = await db
      .select()
      .from(topics)
      .where(eq(topics.clientId, erste.id))
      .limit(1);
    const r = await archiveTopic(erste.id, topic!.id, topic!.version);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cascadedMessageIds).toEqual([m1.id]);

    expect((await getMessage(erste.id, m1.id))?.archivedAt).not.toBeNull();
  });

  it("restoreMessage refuses while parent audience is archived (parent-first guard)", async () => {
    const { archiveAudience } = await import("@/lib/entities/audiences");
    const { restoreMessage } = await import("@/lib/entities/messages");
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const [aud] = await db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .limit(1);
    await archiveAudience(erste.id, aud!.id, aud!.version);

    // m was cascade-archived; its version is now 2 (archive bumped).
    const archived = await getMessage(erste.id, m.id);
    expect(archived?.archivedAt).not.toBeNull();
    const result = await restoreMessage(erste.id, m.id, archived!.version);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("parent_archived");
      expect(result.parent?.type).toBe("audience");
      expect(result.parent?.key).toBe("aud1");
    }
  });

  it("restoreMessage works once the parent is restored (full round-trip)", async () => {
    const { archiveAudience, restoreAudience } = await import(
      "@/lib/entities/audiences"
    );
    const { restoreMessage } = await import("@/lib/entities/messages");
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const [aud] = await db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .limit(1);

    await archiveAudience(erste.id, aud!.id, aud!.version);
    const [audAfterArchive] = await db
      .select()
      .from(audiences)
      .where(eq(audiences.id, aud!.id))
      .limit(1);
    await restoreAudience(erste.id, aud!.id, audAfterArchive!.version);

    const mArchived = await getMessage(erste.id, m.id);
    const r = await restoreMessage(erste.id, m.id, mArchived!.version);
    expect(r.ok).toBe(true);
    expect((await getMessage(erste.id, m.id))?.archivedAt).toBeNull();
  });
});

describe("messages — soft archive", () => {
  it("DELETE sets archived_at instead of removing the row", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const r = await archiveMessage(erste.id, m.id, m.version);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.archivedAt).not.toBeNull();
    expect((await getMessage(erste.id, m.id))?.archivedAt).not.toBeNull();
  });

  it("listMessages excludes archived by default; includeArchived shows them", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    await archiveMessage(erste.id, m.id, m.version);

    expect(await listMessages(erste.id)).toHaveLength(0);
    expect(await listMessages(erste.id, { includeArchived: true })).toHaveLength(
      1,
    );
  });

  it("after archiving an MC, a new MC inserted in the same cell starts fresh from global max", async () => {
    // Mirrors the v5 `cell-only-has-deleted` numbering rule, ported to archive.
    await seedAudienceAndTopic(erste.id);
    const a = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    await archiveMessage(erste.id, a.id, a.version);
    await archiveMessage(erste.id, b.id, b.version);

    const fresh = await createMessage(erste.id, {
      topic: "top1",
      audience: "aud1",
    });
    expect(fresh.number).toBe(1);
    expect(fresh.variant).toBe("a");
  });
});

describe("messages — client scoping", () => {
  it("listMessages on Erste does not return Telekom messages", async () => {
    await seedAudienceAndTopic(erste.id);
    await seedAudienceAndTopic(telekom.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1", name: "E" });
    await createMessage(telekom.id, {
      topic: "top1",
      audience: "aud1",
      name: "T",
    });

    const e = await listMessages(erste.id);
    const t = await listMessages(telekom.id);
    expect(e.map((r) => r.name)).toEqual(["E"]);
    expect(t.map((r) => r.name)).toEqual(["T"]);
  });

  it("update with foreign client_id is a no-op (returns not-found)", async () => {
    await seedAudienceAndTopic(telekom.id);
    const t = await createMessage(telekom.id, {
      topic: "top1",
      audience: "aud1",
      name: "T",
    });
    const r = await updateMessage(erste.id, t.id, t.version, { name: "hijack" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect((await getMessage(telekom.id, t.id))?.name).toBe("T");
  });

  it("MC numbering counts are isolated per client", async () => {
    await seedAudienceAndTopic(erste.id);
    await seedAudienceAndTopic(telekom.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const tFirst = await createMessage(telekom.id, {
      topic: "top1",
      audience: "aud1",
    });
    expect(tFirst.number).toBe(1);
    expect(tFirst.variant).toBe("a");
  });
});
