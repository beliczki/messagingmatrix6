import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
import {
  copyMessages,
  createMessage,
  getMessage,
  getMessageByPmmid,
  listMessages,
  moveMessages,
  updateMessage,
} from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

async function seedAudience(
  clientId: number,
  key: string,
  fields: Record<string, unknown> = {},
) {
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
      ...fields,
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

describe("copyMessages", () => {
  it("copies 1 source MC into 3 audience columns under the same topic", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedAudience(erste.id, "aud3");
    await seedAudience(erste.id, "aud4");
    await seedTopic(erste.id, "top1");

    const source = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "Source MC",
      headline: "Hello",
    });

    const { created } = await copyMessages(
      erste.id,
      [source.pmmid!],
      ["aud2", "aud3", "aud4"],
    );

    expect(created).toHaveLength(3);
    for (const row of created) {
      expect(row.topic).toBe("top1");
      expect(row.name).toBe("Source MC");
      expect(row.headline).toBe("Hello");
      expect(row.pmmid).not.toBe(source.pmmid);
      expect(row.id).not.toBe(source.id);
    }
    expect(created.map((r) => r.audience).sort()).toEqual(["aud2", "aud3", "aud4"]);
  });

  it("clones disclaimer / *Style / customCss fields (regression: createMessage previously dropped these)", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const source = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      disclaimer: "Terms apply",
      headlineStyle: "font-size:1.1rem;",
      copy1Style: "color:red;",
      copy2Style: "color:blue;",
      disclaimerStyle: "font-size:0.7rem;",
      ctaStyle: "background:gold;",
      customCss: ".x{display:none;}",
    });
    expect(source.disclaimer).toBe("Terms apply");
    expect(source.headlineStyle).toBe("font-size:1.1rem;");

    const { created } = await copyMessages(erste.id, [source.pmmid!], ["aud2"]);
    const copy = created[0];
    expect(copy.disclaimer).toBe("Terms apply");
    expect(copy.headlineStyle).toBe("font-size:1.1rem;");
    expect(copy.copy1Style).toBe("color:red;");
    expect(copy.copy2Style).toBe("color:blue;");
    expect(copy.disclaimerStyle).toBe("font-size:0.7rem;");
    expect(copy.ctaStyle).toBe("background:gold;");
    expect(copy.customCss).toBe(".x{display:none;}");
  });

  it("applies fieldOverrides on top of cloned fields", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const source = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "Original",
      headline: "Original headline",
    });

    const { created } = await copyMessages(
      erste.id,
      [source.pmmid!],
      ["aud2"],
      { fieldOverrides: { name: "Override" } },
    );
    expect(created[0].name).toBe("Override");
    expect(created[0].headline).toBe("Original headline");
  });

  it("throws when source PMMID is unknown", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    await expect(
      copyMessages(erste.id, ["does-not-exist"], ["aud1"]),
    ).rejects.toThrow();
  });

  it("preserves source (number, variant) when target cells are empty", async () => {
    // Regression: copy used to call createMessage → nextMcSlot on an empty
    // target cell returns MAX(global)+1, so every target audience got a fresh
    // global number. After fix, the source's (number, variant) is reused as-is
    // when the target cell is free.
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedAudience(erste.id, "aud3");
    await seedTopic(erste.id, "top1");

    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const c = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect([a.number, b.number, c.number]).toEqual([1, 1, 1]);
    expect([a.variant, b.variant, c.variant]).toEqual(["a", "b", "c"]);

    const { created } = await copyMessages(
      erste.id,
      [a.pmmid!, b.pmmid!, c.pmmid!],
      ["aud2", "aud3"],
    );

    expect(created).toHaveLength(6);
    for (const row of created) {
      expect(row.number).toBe(1);
      expect(row.topic).toBe("top1");
      expect(["aud2", "aud3"]).toContain(row.audience);
    }
    const tuples = created
      .map((r) => `${r.audience}|${r.number}${r.variant}`)
      .sort();
    expect(tuples).toEqual([
      "aud2|1a",
      "aud2|1b",
      "aud2|1c",
      "aud3|1a",
      "aud3|1b",
      "aud3|1c",
    ]);
  });

  it("bumps variant on collision in target cell", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const src = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect([src.number, src.variant]).toEqual([1, "a"]);
    // Pre-seed aud2 with a colliding MC1a.
    await db.insert(messages).values({
      clientId: erste.id,
      number: 1,
      variant: "a",
      audience: "aud2",
      topic: "top1",
      versionNo: 1,
      pmmid: "seed-aud2-1a",
    });

    const { created } = await copyMessages(erste.id, [src.pmmid!], ["aud2"]);
    expect(created).toHaveLength(1);
    expect(created[0].audience).toBe("aud2");
    expect(created[0].number).toBe(1); // same number
    expect(created[0].variant).toBe("b"); // bumped from collision
  });

  it("batch copy into the same empty cell stacks variants without colliding with itself", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    // Two sources in aud1 with same number, different variants.
    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect([a.number, a.variant, b.number, b.variant]).toEqual([1, "a", 1, "b"]);

    // Empty aud2 cell — first copy lands at 1a, second sees planned 1a and
    // its own 1b is free, lands at 1b.
    const { created } = await copyMessages(erste.id, [a.pmmid!, b.pmmid!], ["aud2"]);
    expect(created).toHaveLength(2);
    expect(created.map((r) => `${r.number}${r.variant}`).sort()).toEqual([
      "1a",
      "1b",
    ]);
  });
});

describe("moveMessages", () => {
  it("moves 2 MCs into one audience — PMMID regenerated against new audience, versionNo frozen, version+1, source removed from origin", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1", name: "A" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top1", name: "B" });

    const result = await moveMessages(
      erste.id,
      [
        { mcLabel: a.pmmid!, expectedVersion: a.version },
        { mcLabel: b.pmmid!, expectedVersion: b.version },
      ],
      "aud2",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated).toHaveLength(2);
    for (const row of result.updated) {
      expect(row.audience).toBe("aud2");
      expect(row.topic).toBe("top1");
      expect(row.version).toBe(2); // optimistic lock bumped once
      expect(row.pmmid).toContain("aud2"); // new audience encoded in pmmid
      expect(row.pmmid).not.toContain("aud1"); // old audience evicted
    }
    // Source's old pmmid is gone from the index (regenerated).
    expect(await getMessageByPmmid(erste.id, a.pmmid!)).toBeNull();
    // The row still exists, accessible via the new pmmid.
    const movedA = (await getMessage(erste.id, a.id))!;
    expect(movedA.audience).toBe("aud2");
    expect(movedA.pmmid).not.toBe(a.pmmid); // regenerated
    expect(movedA.versionNo).toBe(a.versionNo); // MC v-counter still frozen

    // Origin cell is empty for these PMMIDs.
    const inAud1 = (await listMessages(erste.id)).filter((m) => m.audience === "aud1");
    expect(inAud1).toHaveLength(0);
  });

  it("auto-bumps variant on collision in target cell", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");

    const inAud1 = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect(inAud1.number).toBe(1);
    expect(inAud1.variant).toBe("a");
    const [existingInAud2] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "aud2",
        topic: "top1",
        versionNo: 1,
        pmmid: "seed-aud2-1a",
      })
      .returning();

    const result = await moveMessages(
      erste.id,
      [{ mcLabel: inAud1.pmmid!, expectedVersion: inAud1.version }],
      "aud2",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.updated[0];
    expect(moved.audience).toBe("aud2");
    expect(moved.number).toBe(1);
    expect(moved.variant).toBe("b"); // bumped
    expect(moved.pmmid).not.toBe(inAud1.pmmid); // regenerated
    expect(moved.pmmid).toContain("aud2");
    expect(moved.pmmid).toContain("v_b");

    // Existing chip in aud2 untouched.
    const untouched = (await getMessage(erste.id, existingInAud2.id))!;
    expect(untouched.variant).toBe("a");
    expect(untouched.version).toBe(existingInAud2.version);
  });

  it("returns version_conflict on stale expectedVersion, no row mutated", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: "aud1", topic: "top1", name: "M" });

    // Bump the version on m so the next move sees a stale version.
    await updateMessage(erste.id, m.id, m.version, { name: "Updated" });

    const result = await moveMessages(
      erste.id,
      [{ mcLabel: m.pmmid!, expectedVersion: m.version }],
      "aud2",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("version_conflict");
    expect(result.mcLabel).toBe(m.pmmid);

    const after = (await getMessage(erste.id, m.id))!;
    expect(after.audience).toBe("aud1"); // not moved
  });

  it("rejects cross-topic move", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    await seedTopic(erste.id, "top2");
    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top2" });

    const result = await moveMessages(
      erste.id,
      [
        { mcLabel: a.pmmid!, expectedVersion: a.version },
        { mcLabel: b.pmmid!, expectedVersion: b.version },
      ],
      "aud2",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cross_topic_move_not_supported");

    // Neither row moved.
    expect((await getMessage(erste.id, a.id))!.audience).toBe("aud1");
    expect((await getMessage(erste.id, b.id))!.audience).toBe("aud1");
  });

  it("rejects unknown target audience", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: "aud1", topic: "top1" });

    const result = await moveMessages(
      erste.id,
      [{ mcLabel: m.pmmid!, expectedVersion: m.version }],
      "ghost",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("target_audience_not_found");
  });

  it.each([["ACTIVE"], ["INACTIVE"], ["ARCHIVED"]])(
    "rejects move when source status is %s — row untouched",
    async (lockedStatus) => {
      await seedAudience(erste.id, "aud1");
      await seedAudience(erste.id, "aud2");
      await seedTopic(erste.id, "top1");
      const m = await createMessage(erste.id, {
        audience: "aud1",
        topic: "top1",
        status: lockedStatus,
      });

      const result = await moveMessages(
        erste.id,
        [{ mcLabel: m.pmmid!, expectedVersion: m.version }],
        "aud2",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("row_locked_by_status");
      expect(result.status).toBe(lockedStatus);

      // Source row untouched — same audience, same pmmid, same version.
      const after = (await getMessage(erste.id, m.id))!;
      expect(after.audience).toBe("aud1");
      expect(after.pmmid).toBe(m.pmmid);
      expect(after.version).toBe(m.version);
    },
  );

  it("regenerates UTM columns against the new audience's strategy/product", async () => {
    await seedAudience(erste.id, "aud1", { strategy: "Prospecting" });
    await seedAudience(erste.id, "aud2", { strategy: "Retargeting" });
    await seedTopic(erste.id, "top1");
    // Patterns: utm_campaign mirrors strategy so the diff is visible.
    await db.insert(config).values({
      clientId: erste.id,
      key: "patterns",
      value: JSON.stringify({
        trafficking: { utm_campaign: "{{strategy}}" },
      }),
    });

    const m = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect(m.utmCampaign).toBe("Prospecting");

    const result = await moveMessages(
      erste.id,
      [{ mcLabel: m.pmmid!, expectedVersion: m.version }],
      "aud2",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updated[0].utmCampaign).toBe("Retargeting");
  });

  it("batch into the same cell stacks variants without colliding with itself", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    // Source cell: MC1a + MC1b.
    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    expect([a.number, a.variant, b.number, b.variant]).toEqual([1, "a", 1, "b"]);
    // Target cell pre-seeded with a colliding MC1a.
    await db.insert(messages).values({
      clientId: erste.id,
      number: 1,
      variant: "a",
      audience: "aud2",
      topic: "top1",
      versionNo: 1,
      pmmid: "seed-aud2-1a",
    });

    const result = await moveMessages(
      erste.id,
      [
        { mcLabel: a.pmmid!, expectedVersion: a.version },
        { mcLabel: b.pmmid!, expectedVersion: b.version },
      ],
      "aud2",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const variants = result.updated.map((r) => r.variant).sort();
    expect(variants).toEqual(["b", "c"]);
  });
});

describe("copy / move tenant isolation", () => {
  it("copy with another client's PMMID is rejected", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "T" })
      .returning();
    await seedAudience(erste.id, "aud1");
    await seedAudience(telekom.id, "aud1");
    await seedTopic(erste.id, "top1");
    await seedTopic(telekom.id, "top1");
    const telekomMsg = await createMessage(telekom.id, { audience: "aud1", topic: "top1" });

    await expect(
      copyMessages(erste.id, [telekomMsg.pmmid!], ["aud1"]),
    ).rejects.toThrow();
  });

  it("move with another client's PMMID returns not_found", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "T" })
      .returning();
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedAudience(telekom.id, "aud1");
    await seedTopic(erste.id, "top1");
    await seedTopic(telekom.id, "top1");
    const telekomMsg = await createMessage(telekom.id, { audience: "aud1", topic: "top1" });

    const result = await moveMessages(
      erste.id,
      [{ mcLabel: telekomMsg.pmmid!, expectedVersion: telekomMsg.version }],
      "aud2",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_found");
  });
});
