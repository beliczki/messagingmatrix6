import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages, topics } from "@/db/schema";
import {
  createMessage,
  getMessage,
  listMessages,
  MessageError,
  softDeleteMessage,
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

describe("messages — soft delete", () => {
  it("DELETE sets status='deleted' instead of removing the row", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const r = softDeleteMessage(erste.id, m.id, m.version);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.status).toBe("deleted");
    expect(getMessage(erste.id, m.id)?.status).toBe("deleted");
  });

  it("listMessages excludes soft-deleted by default; includeDeleted shows them", () => {
    seedAudienceAndTopic(erste.id);
    const m = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    softDeleteMessage(erste.id, m.id, m.version);

    expect(listMessages(erste.id)).toHaveLength(0);
    expect(listMessages(erste.id, { includeDeleted: true })).toHaveLength(1);
  });

  it("after soft-deleting an MC, a new MC inserted in the same cell starts fresh from global max", () => {
    // This mirrors the v5 fixture `cell-only-has-deleted` numbering rule.
    seedAudienceAndTopic(erste.id);
    const a = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const b = createMessage(erste.id, { topic: "top1", audience: "aud1" });
    softDeleteMessage(erste.id, a.id, a.version);
    softDeleteMessage(erste.id, b.id, b.version);

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
