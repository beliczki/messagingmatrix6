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

function seedAudienceAndTopic(clientId: number, audKey = "aud1", topKey = "top1") {
  const a = db
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
    .returning()
    .get();
  const t = db
    .insert(topics)
    .values({
      clientId,
      key: topKey,
      name: topKey.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
    })
    .returning()
    .get();
  return { a, t };
}

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
});

afterEach(() => {
  h.cleanup();
});

describe("messages — numbering on create", () => {
  it("first message in empty matrix gets #1a v1", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(m.number).toBe(1);
    expect(m.variant).toBe("a");
    expect(m.versionNo).toBe(1);
  });

  it("second message in same cell gets next variant (b)", () => {
    seedAudienceAndTopic(erste.id);
    const a = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(a.variant).toBe("a");
    expect(b.variant).toBe("b");
    expect(b.number).toBe(a.number);
  });

  it("message in a different cell gets the next free number", () => {
    seedAudienceAndTopic(erste.id, "aud1", "top1");
    seedAudienceAndTopic(erste.id, "aud2", "top2");
    createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const m = createMessage(erste.id, { topic: "top2", audience: "aud2" });
    expect(m.number).toBe(2);
    expect(m.variant).toBe("a");
  });

  it("PMMID is auto-filled from the hardcoded format when no pattern is set", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(m.pmmid).toBe("a_aud1-t_top1-m_1-v_a-n_1");
  });

  it("create rejects unknown audience or topic", () => {
    seedAudienceAndTopic(erste.id);
    expect(() =>
      createMessage(erste.id, { topic: "top1", audience: "ghost" }),
    ).toThrow(MessageError);
    expect(() =>
      createMessage(erste.id, { topic: "ghost", audience: "aud1" }),
    ).toThrow(MessageError);
  });
});

describe("messages — cascade archive + parent-first restore", () => {
  it("archiving an audience cascades to all its messages", async () => {
    const { archiveAudience } = await import("@/lib/entities/audiences");
    seedAudienceAndTopic(erste.id);
    const m1 = createMessage(erste.id, { topic: "top1", audience: "aud1", name: "M1" });
    const m2 = createMessage(erste.id, { topic: "top1", audience: "aud1", name: "M2" });

    const aud = db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .get();
    const r = archiveAudience(erste.id, aud!.id, aud!.version);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cascadedMessageIds.sort()).toEqual([m1.id, m2.id].sort());
    }

    expect(getMessage(erste.id, m1.id)?.archivedAt).not.toBeNull();
    expect(getMessage(erste.id, m2.id)?.archivedAt).not.toBeNull();
    // listMessages default filter excludes archived rows.
    expect(listMessages(erste.id)).toHaveLength(0);
  });

  it("archiving a topic cascades to all its messages", async () => {
    const { archiveTopic } = await import("@/lib/entities/topics");
    seedAudienceAndTopic(erste.id);
    const m1 = createMessage(erste.id, { topic: "top1", audience: "aud1", name: "M1" });

    const topic = db
      .select()
      .from(topics)
      .where(eq(topics.clientId, erste.id))
      .get();
    const r = archiveTopic(erste.id, topic!.id, topic!.version);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cascadedMessageIds).toEqual([m1.id]);

    expect(getMessage(erste.id, m1.id)?.archivedAt).not.toBeNull();
  });

  it("restoreMessage refuses while parent audience is archived (parent-first guard)", async () => {
    const { archiveAudience } = await import("@/lib/entities/audiences");
    const { restoreMessage } = await import("@/lib/entities/messages");
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const aud = db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .get();
    archiveAudience(erste.id, aud!.id, aud!.version);

    // m was cascade-archived; its version is now 2 (archive bumped).
    const archived = getMessage(erste.id, m.id);
    expect(archived?.archivedAt).not.toBeNull();
    const result = restoreMessage(erste.id, m.id, archived!.version);
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
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const aud = db
      .select()
      .from(audiences)
      .where(eq(audiences.clientId, erste.id))
      .get();

    archiveAudience(erste.id, aud!.id, aud!.version);
    const audAfterArchive = db
      .select()
      .from(audiences)
      .where(eq(audiences.id, aud!.id))
      .get();
    restoreAudience(erste.id, aud!.id, audAfterArchive!.version);

    const mArchived = getMessage(erste.id, m.id);
    const r = restoreMessage(erste.id, m.id, mArchived!.version);
    expect(r.ok).toBe(true);
    expect(getMessage(erste.id, m.id)?.archivedAt).toBeNull();
  });
});

describe("messages — soft archive", () => {
  it("DELETE sets archived_at instead of removing the row", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const r = archiveMessage(erste.id, m.id, m.version);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.archivedAt).not.toBeNull();
    expect(getMessage(erste.id, m.id)?.archivedAt).not.toBeNull();
  });

  it("listMessages excludes archived by default; includeArchived shows them", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    archiveMessage(erste.id, m.id, m.version);

    expect(listMessages(erste.id)).toHaveLength(0);
    expect(listMessages(erste.id, { includeArchived: true })).toHaveLength(1);
  });

  it("after archiving an MC, a new MC inserted in the same cell starts fresh from global max", () => {
    // Mirrors the v5 `cell-only-has-deleted` numbering rule, ported to archive.
    seedAudienceAndTopic(erste.id);
    const a = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    archiveMessage(erste.id, a.id, a.version);
    archiveMessage(erste.id, b.id, b.version);

    const fresh = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(fresh.number).toBe(1);
    expect(fresh.variant).toBe("a");
  });
});

describe("messages — client scoping", () => {
  it("listMessages on Erste does not return Telekom messages", () => {
    seedAudienceAndTopic(erste.id);
    seedAudienceAndTopic(telekom.id);
    createMessage(erste.id, { topic: "top1", audience: "aud1", name: "E" });
    createMessage(telekom.id, { topic: "top1", audience: "aud1", name: "T" });

    const e = listMessages(erste.id);
    const t = listMessages(telekom.id);
    expect(e.map((r) => r.name)).toEqual(["E"]);
    expect(t.map((r) => r.name)).toEqual(["T"]);
  });

  it("update with foreign client_id is a no-op (returns not-found)", () => {
    seedAudienceAndTopic(telekom.id);
    const t = createMessage(telekom.id, { topic: "top1", audience: "aud1", name: "T" });
    const r = updateMessage(erste.id, t.id, t.version, { name: "hijack" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect(getMessage(telekom.id, t.id)?.name).toBe("T");
  });

  it("MC numbering counts are isolated per client", () => {
    seedAudienceAndTopic(erste.id);
    seedAudienceAndTopic(telekom.id);
    createMessage(erste.id, { topic: "top1", audience: "aud1" });
    createMessage(erste.id, { topic: "top1", audience: "aud1" });
    createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const tFirst = createMessage(telekom.id, { topic: "top1", audience: "aud1" });
    expect(tFirst.number).toBe(1);
    expect(tFirst.variant).toBe("a");
  });
});
