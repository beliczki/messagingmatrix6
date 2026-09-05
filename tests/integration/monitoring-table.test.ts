import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages, monitoring } from "@/db/schema";
import { buildMessageResolver } from "@/lib/adform-report";
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

  it("stores the match level (migration 0003)", async () => {
    await db.insert(monitoring).values(baseRow({ matchLevel: "family_known" }));
    const [row] = await db
      .select()
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id))
      .limit(1);
    expect(row!.matchLevel).toBe("family_known");
  });

  // The import route's match decision end-to-end: messages read back from the
  // DB feed buildMessageResolver exactly as /api/monitoring/import does.
  it("resolves report keys against DB messages via the tiered resolver", async () => {
    await db.insert(messages).values([
      { clientId: erste.id, number: 290, variant: "a", audience: "SZK_INCOMING", topic: "SZK_kerdoiv_NA_hiteltinder" },
      { clientId: erste.id, number: 316, variant: "a", audience: "SZK_wla_auto", topic: "SZK_felhaszcelja" },
      { clientId: erste.id, number: 316, variant: "a", audience: "SZK_wlc_auto", topic: "SZK_felhaszcelja" },
    ]);
    const msgRows = await db
      .select({
        id: messages.id,
        number: messages.number,
        variant: messages.variant,
        audience: messages.audience,
        topic: messages.topic,
      })
      .from(messages)
      .where(
        and(eq(messages.clientId, erste.id), isNotNull(messages.audience)),
      );
    const resolve = buildMessageResolver(
      msgRows.filter(
        (r): r is typeof r & { audience: string; topic: string } =>
          r.audience !== null && r.topic !== null,
      ),
    );

    const exact = resolve(290, "a", "szk_incoming", "szk_kerdoiv_na_hiteltinder");
    expect(exact.matchLevel).toBe("exact");
    expect(exact.messageId).not.toBeNull();

    const family = resolve(290, "hitelvalaszto_a", "wid", "szk_q2");
    expect(family.matchLevel).toBe("family");
    expect(family.messageId).toBe(exact.messageId);

    expect(resolve(316, "a_calc_auto", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: "family_known",
    });
    expect(resolve(999, "a", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: null,
    });
  });

  // A draft carries a number and a variant, which is exactly what the
  // family-level fallback keys on — so without the placed-only scope a report
  // row would resolve onto work that has never run anywhere.
  it("never resolves a report key onto a DRAFT", async () => {
    await db.insert(messages).values([
      { clientId: erste.id, number: 421, variant: "a", status: "DRAFT", audience: null, topic: null },
    ]);
    const msgRows = await db
      .select({
        id: messages.id,
        number: messages.number,
        variant: messages.variant,
        audience: messages.audience,
        topic: messages.topic,
      })
      .from(messages)
      .where(
        and(eq(messages.clientId, erste.id), isNotNull(messages.audience)),
      );
    expect(msgRows).toHaveLength(0);

    const resolve = buildMessageResolver(
      msgRows.filter(
        (r): r is typeof r & { audience: string; topic: string } =>
          r.audience !== null && r.topic !== null,
      ),
    );
    expect(resolve(421, "a", "wid", "szk_q2")).toEqual({
      messageId: null,
      matchLevel: null,
    });
  });
});
