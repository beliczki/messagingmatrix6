import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, messages, monitoring } from "@/db/schema";
import { monthlyDelivery } from "@/lib/dashboard-monitoring";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let other: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [other] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

let key = 0;
function row(over: Partial<typeof monitoring.$inferInsert> = {}) {
  key += 1;
  return {
    clientId: erste.id,
    platform: "adform",
    audienceKey: `AUD_${key}`,
    topicKey: `topic_${key}`,
    mcNumber: key,
    mcVariant: "a",
    size: "300x250",
    impressions: 1000,
    clicks: 10,
    cost: 100,
    periodFrom: "01/08/2026 00:00:00",
    periodTo: "31/08/2026 23:59:59",
    ...over,
  };
}

describe("monthlyDelivery", () => {
  it("sums one row per report period", async () => {
    await db
      .insert(monitoring)
      .values([row({ impressions: 1000, clicks: 10, cost: 100 }), row()]);

    const months = await monthlyDelivery(erste.id);
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({
      periodFrom: "01/08/2026 00:00:00",
      impressions: 2000,
      clicks: 20,
      cost: 200,
    });
  });

  it("drops the 1x1 click-tracker rows", async () => {
    // Real shape: the pixel rows carry clicks and cost against zero
    // impressions, which would make CTR meaningless and double the spend.
    await db.insert(monitoring).values([
      row({ impressions: 5000, clicks: 50, cost: 400 }),
      row({ size: "1x1", impressions: 0, clicks: 9000, cost: 7000 }),
    ]);

    const [august] = await monthlyDelivery(erste.id);
    expect(august).toMatchObject({ impressions: 5000, clicks: 50, cost: 400 });
  });

  it("orders on the parsed date, not the stored DD/MM/YYYY text", async () => {
    // "01/12/2025" sorts AFTER "01/05/2026" as text — a string ordering reads
    // the trend backwards across a year end.
    await db.insert(monitoring).values([
      row({
        periodFrom: "01/01/2026 00:00:00",
        periodTo: "31/01/2026 23:59:59",
        impressions: 200,
      }),
      row({
        periodFrom: "01/12/2025 00:00:00",
        periodTo: "31/12/2025 23:59:59",
        impressions: 100,
      }),
    ]);

    const months = await monthlyDelivery(erste.id);
    expect(months.map((m) => m.periodFrom)).toEqual([
      "01/12/2025 00:00:00",
      "01/01/2026 00:00:00",
    ]);
  });

  it("keeps the newest n periods, oldest first", async () => {
    await db.insert(monitoring).values(
      ["05", "06", "07"].map((month) =>
        row({
          periodFrom: `01/${month}/2026 00:00:00`,
          periodTo: `28/${month}/2026 23:59:59`,
        }),
      ),
    );

    const months = await monthlyDelivery(erste.id, 2);
    expect(months.map((m) => m.periodFrom)).toEqual([
      "01/06/2026 00:00:00",
      "01/07/2026 00:00:00",
    ]);
  });

  it("counts only linked rows as matched impressions", async () => {
    const [message] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "SZK_x",
        topic: "SZK_topic",
      })
      .returning();

    await db.insert(monitoring).values([
      row({ impressions: 3000, messageId: message.id, matchLevel: "exact" }),
      row({ impressions: 7000 }), // unmatched publisher line
    ]);

    const [august] = await monthlyDelivery(erste.id);
    expect(august).toMatchObject({
      impressions: 10000,
      matchedImpressions: 3000,
    });
  });

  it("never reads another client's periods", async () => {
    await db
      .insert(monitoring)
      .values([row(), row({ clientId: other.id, impressions: 999999 })]);

    const [august] = await monthlyDelivery(erste.id);
    expect(august.impressions).toBe(1000);
    expect(await monthlyDelivery(other.id)).toHaveLength(1);
  });

  it("narrows the series to the selected products", async () => {
    // The rows carrying no product are the unmatched publisher lines; a product
    // filter drops them from the denominator too, which is why coverage reads
    // far higher under a filter than overall.
    await db.insert(monitoring).values([
      row({ product: "SZK", impressions: 1000, clicks: 10 }),
      row({ product: "HK", impressions: 2000, clicks: 20 }),
      row({ product: null, impressions: 7000, clicks: 70 }),
    ]);

    expect((await monthlyDelivery(erste.id))[0]).toMatchObject({
      impressions: 10000,
    });
    expect((await monthlyDelivery(erste.id, 6, ["SZK"]))[0]).toMatchObject({
      impressions: 1000,
      clicks: 10,
    });
    expect(
      (await monthlyDelivery(erste.id, 6, ["SZK", "HK"]))[0],
    ).toMatchObject({ impressions: 3000, clicks: 30 });
    expect(await monthlyDelivery(erste.id, 6, ["VAL"])).toEqual([]);
  });

  it("keeps matched impressions inside the product scope", async () => {
    const [message] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "SZK_x",
        topic: "SZK_topic",
      })
      .returning();
    await db.insert(monitoring).values([
      row({ product: "SZK", impressions: 800, messageId: message.id }),
      row({ product: "SZK", impressions: 200 }),
      row({ product: "HK", impressions: 5000, messageId: message.id }),
    ]);

    const [szk] = await monthlyDelivery(erste.id, 6, ["SZK"]);
    expect(szk).toMatchObject({ impressions: 1000, matchedImpressions: 800 });
  });

  it("returns an empty series when nothing was ever imported", async () => {
    expect(await monthlyDelivery(erste.id)).toEqual([]);
  });
});
