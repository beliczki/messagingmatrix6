import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
import {
  archiveMessage,
  copyMessages,
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

  // The default moved from INCOMING to PREVIEW on 2026-09-05: a card reaches
  // the matrix with its template and content already in place, so the operator
  // was flipping every new card to PREVIEW by hand.
  it("new message defaults to PREVIEW status; an explicit status wins", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    const def = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(def.status).toBe("PREVIEW");
    const explicit = await createMessage(erste.id, {
      topic: "top2",
      audience: "aud2",
      status: "ACTIVE",
    });
    expect(explicit.status).toBe("ACTIVE");
  });

  it("DCO MC inherits the client's default template; nonDCO stays image-based", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1"); // DCO audience
    // A nonDCO channel-audience + its topic.
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "ch_disp",
      name: "Display",
      orderIndex: 1,
      channel: "DISP",
    });
    await db.insert(topics).values({
      clientId: erste.id,
      key: "topN",
      name: "TOPN",
      orderIndex: 1,
      product: "Loans",
    });
    await db.insert(config).values({
      clientId: erste.id,
      key: "defaultTemplate",
      value: "erste-html",
    });

    const dco = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(dco.template).toBe("erste-html");

    const nondco = await createMessage(erste.id, {
      topic: "topN",
      audience: "ch_disp",
    });
    expect(nondco.template).toBeNull();

    // An explicit template always wins over the default.
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    const explicit = await createMessage(erste.id, {
      topic: "top2",
      audience: "aud2",
      template: "other-tpl",
    });
    expect(explicit.template).toBe("other-tpl");
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

  it("requestedNumber introduces a globally-free number into an occupied cell", async () => {
    // v6 multi-number cells: a cell may hold several MC numbers (creative
    // generations), so a free number is welcome even when the cell is taken.
    await seedAudienceAndTopic(erste.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 7 },
    );
    expect(m.number).toBe(7);
    expect(m.variant).toBe("a");
    expect(m.pmmid).toBe("a_aud1-t_top1-m_7-v_a-n_1");
  });

  it("requestedNumber living in a different topic is rejected even for an occupied cell", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1
    await createMessage(erste.id, { topic: "top2", audience: "aud2" }); // MC2
    await expect(
      createMessage(
        erste.id,
        { topic: "top2", audience: "aud2" },
        { requestedNumber: 1 },
      ),
    ).rejects.toThrow(/already in use/);
  });

  it("requestedNumber may reuse a DCO number for a nonDCO channel audience (cross-axis pairing)", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // DCO MC1
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "ch_disp",
      name: "Display",
      orderIndex: 1,
      channel: "DISP",
    });
    await db.insert(topics).values({
      clientId: erste.id,
      key: "nd_top",
      name: "ND",
      orderIndex: 1,
      product: "Loans",
    });
    // The DCO MC1 lives in top1; a nonDCO audience is a separate number space,
    // so it may claim MC1 in its own topic — the static pair of the DCO card.
    const nd = await createMessage(
      erste.id,
      { topic: "nd_top", audience: "ch_disp" },
      { requestedNumber: 1 },
    );
    expect(nd.number).toBe(1);
    expect(nd.audience).toBe("ch_disp");
  });

  it("within the nonDCO axis a number still cannot span topics", async () => {
    await db.insert(audiences).values([
      { clientId: erste.id, key: "ch_disp", name: "Display", orderIndex: 0, channel: "DISP" },
      { clientId: erste.id, key: "ch_soc", name: "Social", orderIndex: 1, channel: "SOC" },
    ]);
    await db.insert(topics).values([
      { clientId: erste.id, key: "nd1", name: "ND1", orderIndex: 0, product: "Loans" },
      { clientId: erste.id, key: "nd2", name: "ND2", orderIndex: 1, product: "Loans" },
    ]);
    await createMessage(erste.id, { topic: "nd1", audience: "ch_disp" }, { requestedNumber: 5 });
    await expect(
      createMessage(erste.id, { topic: "nd2", audience: "ch_soc" }, { requestedNumber: 5 }),
    ).rejects.toThrow(/already in use/);
  });

  it("auto-assign is axis-scoped — a tall nonDCO space does not push a new DCO MC up", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "ch_disp",
      name: "Display",
      orderIndex: 1,
      channel: "DISP",
    });
    await db.insert(topics).values({
      clientId: erste.id,
      key: "nd_top",
      name: "ND",
      orderIndex: 1,
      product: "Loans",
    });
    // The static library climbed to MC800 on the nonDCO axis…
    await createMessage(
      erste.id,
      { topic: "nd_top", audience: "ch_disp" },
      { requestedNumber: 800 },
    );
    // …a brand-new DCO MC must still start at 1, not 801.
    const dco = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(dco.number).toBe(1);
    // And the next nonDCO one continues its own space at 801.
    await seedAudienceAndTopic(erste.id, "aud2", "nd_top2");
    await db
      .update(audiences)
      .set({ channel: "SOC" })
      .where(and(eq(audiences.clientId, erste.id), eq(audiences.key, "aud2")));
    const nd = await createMessage(erste.id, {
      topic: "nd_top2",
      audience: "aud2",
    });
    expect(nd.number).toBe(801);
  });

  it("requestedNumber present in a mixed cell adds that number's next variant", async () => {
    await seedAudienceAndTopic(erste.id);
    const a = await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1b
    const gen2 = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 7 },
    ); // MC7a
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 7 },
    );
    expect(m.number).toBe(7);
    expect(m.variant).toBe("b");
    // ...and the first number's sequence is unaffected by MC7's variants.
    const backOnOne = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: a.number },
    );
    expect(backOnOne.number).toBe(a.number);
    expect(backOnOne.variant).toBe("c");
    expect(gen2.variant).toBe("a");
  });

  it('requestedNumber "new" forces a fresh number in an occupied cell', async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    await createMessage(erste.id, { topic: "top2", audience: "aud2" }); // MC2a
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: "new" },
    );
    expect(m.number).toBe(3); // global max + 1
    expect(m.variant).toBe("a");
  });

  it("default create in a mixed cell bumps the first number's own sequence", async () => {
    await seedAudienceAndTopic(erste.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 7 },
    ); // MC7a
    await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 7 },
    ); // MC7b
    // Old bug: variant was max across the whole cell (b -> c) on number 1.
    const m = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    expect(m.number).toBe(1);
    expect(m.variant).toBe("b");
  });

  it("requestedNumber of an archived-only in-cell number is rejected, not attached", async () => {
    await seedAudienceAndTopic(erste.id);
    const a = await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    await archiveMessage(erste.id, a.id, a.version);
    // A live twin of the archived MC1a would carry its PMMID and collide on
    // restore — the retired-number guard rejects with a restore pointer.
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud1" },
        { requestedNumber: 1 },
      ),
    ).rejects.toThrow(/retired.*restore/);
  });

  it("re-creating a same-topic number in another audience is rejected with a copy hint", async () => {
    // Placing an existing card into more audiences is copy's job (it clones
    // the fields) — mc_number claims are for numbers not yet in use. The
    // error must steer the caller to copy, not read as a phantom conflict.
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2"); // aud2 exists; top2 unused here
    await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 316 },
    );
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud2" },
        { requestedNumber: 316 },
      ),
    ).rejects.toThrow(/already lives in this topic.*use copy/);
    // The canonical path — copy — places the card and clones its fields.
    const { created } = await copyMessages(erste.id, ["a_aud1-t_top1-m_316-v_a-n_1"], ["aud2"]);
    expect(created).toHaveLength(1);
    expect([created[0].number, created[0].variant, created[0].audience]).toEqual([316, "a", "aud2"]);
  });

  it("a number held only by archived rows is retired — claim rejected with a restore hint", async () => {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await seedAudienceAndTopic(erste.id, "aud2", "top2");
    const a = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 5 },
    );
    await archiveMessage(erste.id, a.id, a.version);
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud2" },
        { requestedNumber: 5 },
      ),
    ).rejects.toThrow(/retired.*restore/);
  });

  it("requestedVariant pins an explicit letter on a fresh number (317b with no 317a)", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedNumber: 317, requestedVariant: "b" },
    );
    expect(m.number).toBe(317);
    expect(m.variant).toBe("b");
    expect(m.pmmid).toBe("a_aud1-t_top1-m_317-v_b-n_1");
  });

  it("requestedVariant overrides the auto letter even without an explicit number", async () => {
    await seedAudienceAndTopic(erste.id);
    const m = await createMessage(
      erste.id,
      { topic: "top1", audience: "aud1" },
      { requestedVariant: "e" },
    );
    expect(m.number).toBe(1);
    expect(m.variant).toBe("e");
  });

  it("requestedVariant colliding with a live twin in the same cell is rejected", async () => {
    await seedAudienceAndTopic(erste.id);
    await createMessage(erste.id, { topic: "top1", audience: "aud1" }); // MC1a
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud1" },
        { requestedNumber: 1, requestedVariant: "a" },
      ),
    ).rejects.toThrow(/already exists in this cell/);
  });

  it("requestedVariant rejects a non-letter value", async () => {
    await seedAudienceAndTopic(erste.id);
    await expect(
      createMessage(
        erste.id,
        { topic: "top1", audience: "aud1" },
        { requestedVariant: "1" },
      ),
    ).rejects.toThrow(/invalid/);
  });

  it("listMessages includeArchived returns archived rows but never legacy status='deleted'", async () => {
    await seedAudienceAndTopic(erste.id);
    const live = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    const arch = await createMessage(erste.id, { topic: "top1", audience: "aud1" });
    await archiveMessage(erste.id, arch.id, arch.version);
    // Legacy pre-Phase-10a soft-delete: status='deleted', archivedAt null.
    await db
      .update(messages)
      .set({ status: "deleted" })
      .where(eq(messages.id, live.id));
    const extra = await createMessage(erste.id, { topic: "top1", audience: "aud1" });

    const all = await listMessages(erste.id, { includeArchived: true });
    const ids = all.map((m) => m.id);
    expect(ids).toContain(arch.id); // archived visible
    expect(ids).toContain(extra.id);
    expect(ids).not.toContain(live.id); // legacy deleted stays hidden
  });
});

describe("messages — global-edit fan-out is axis-scoped", () => {
  // Numbering lets a DCO card share its number with a static nonDCO twin, so
  // (number, variant) names TWO cards. The fan-out must stay on one axis —
  // otherwise a global edit on the DCO MC1a overwrites the nonDCO MC1a's
  // creative-derived content (and vice versa).
  async function seedTwins() {
    await seedAudienceAndTopic(erste.id, "aud1", "top1");
    await db.insert(audiences).values([
      { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1 },
      {
        clientId: erste.id,
        key: "ch_disp",
        name: "Display",
        orderIndex: 2,
        channel: "DISP",
      },
    ]);
    await db.insert(topics).values({
      clientId: erste.id,
      key: "nd_top",
      name: "ND",
      orderIndex: 1,
      product: "Loans",
    });
    const dco = await createMessage(erste.id, {
      topic: "top1",
      audience: "aud1",
      headline: "DCO original",
    });
    // Second audience copy of the same DCO card — the legitimate fan-out target.
    const [dcoCopy] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: dco.number,
        variant: dco.variant,
        audience: "aud2",
        topic: "top1",
        headline: "DCO original",
      })
      .returning();
    const nondco = await createMessage(
      erste.id,
      {
        topic: "nd_top",
        audience: "ch_disp",
        headline: "static creative",
      },
      { requestedNumber: dco.number },
    );
    expect(nondco.number).toBe(dco.number);
    expect(nondco.variant).toBe(dco.variant);
    return { dco, dcoCopy, nondco };
  }

  it("findSiblings skips the nonDCO namesake of a DCO card", async () => {
    const { findSiblings } = await import("@/lib/entities/messages");
    const { dco, dcoCopy } = await seedTwins();
    const sibs = await findSiblings(erste.id, dco);
    expect(sibs.map((s) => s.id)).toEqual([dcoCopy.id]);
  });

  it("a DCO global edit does not reach the nonDCO twin", async () => {
    const { propagateToSiblings } = await import("@/lib/entities/messages");
    const { dco, dcoCopy, nondco } = await seedTwins();
    await propagateToSiblings(erste.id, dco, { headline: "DCO edited" });
    expect((await getMessage(erste.id, dcoCopy.id))?.headline).toBe(
      "DCO edited",
    );
    expect((await getMessage(erste.id, nondco.id))?.headline).toBe(
      "static creative",
    );
  });

  it("a nonDCO global edit does not reach the DCO namesake", async () => {
    const { propagateToSiblings } = await import("@/lib/entities/messages");
    const { dco, dcoCopy, nondco } = await seedTwins();
    await propagateToSiblings(erste.id, nondco, { headline: "static edited" });
    expect((await getMessage(erste.id, dco.id))?.headline).toBe("DCO original");
    expect((await getMessage(erste.id, dcoCopy.id))?.headline).toBe(
      "DCO original",
    );
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
