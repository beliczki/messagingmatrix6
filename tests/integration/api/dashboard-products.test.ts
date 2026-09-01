import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { audiences, clients, creatives, messages } from "@/db/schema";
import { productInventory } from "@/lib/dashboard-products";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

async function audience(
  clientId: number,
  key: string,
  product: string | null,
  channel: string | null,
) {
  await db
    .insert(audiences)
    .values({ clientId, key, name: key, product, channel, orderIndex: 0 });
}

async function message(clientId: number, audienceKey: string, topic: string, n: number) {
  await db.insert(messages).values({
    clientId,
    number: n,
    variant: "a",
    audience: audienceKey,
    topic,
  });
}

describe("dashboard product inventory", () => {
  // DCO/nonDCO is the audience partition the matrix axis switch uses; a nonDCO
  // cell's product comes from the topic key prefix, because those channel
  // audiences are shared across products and carry none of their own.
  it("splits cells by the audience partition and reads nonDCO product from the topic", async () => {
    await audience(erste.id, "szk_aud", "SZK", null);
    await audience(erste.id, "ch_disp", null, "display");
    await message(erste.id, "szk_aud", "SZK_topic", 1);
    await message(erste.id, "szk_aud", "SZK_topic", 2);
    await message(erste.id, "ch_disp", "VAL_creative_keyword", 3);
    await db.insert(creatives).values([
      { clientId: erste.id, product: "SZK", fileName: "a.png" },
      { clientId: erste.id, product: "VAL", fileName: "b.png" },
      { clientId: erste.id, product: "VAL", fileName: "c.png" },
    ]);

    const inv = await productInventory(erste.id);
    expect(inv.options).toEqual(["SZK", "VAL"]);
    expect(inv.labels).toEqual(["DCO", "nonDCO", "creatives"]);
    expect(inv.counts.SZK).toEqual([2, 0, 1]);
    expect(inv.counts.VAL).toEqual([0, 1, 2]);
  });

  it("leaves archived rows out", async () => {
    await audience(erste.id, "szk_aud", "SZK", null);
    await message(erste.id, "szk_aud", "SZK_topic", 1);
    await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 2,
        variant: "a",
        audience: "szk_aud",
        topic: "SZK_topic",
        archivedAt: "2026-09-01 07:00:00",
      });
    await db.insert(creatives).values([
      { clientId: erste.id, product: "SZK", fileName: "live.png" },
      {
        clientId: erste.id,
        product: "SZK",
        fileName: "gone.png",
        archivedAt: "2026-09-01 07:00:00",
      },
    ]);
    // No channel audience here, so the nonDCO segment drops out entirely —
    // a column of zeros down the whole menu only invites questions.
    const inv = await productInventory(erste.id);
    expect(inv.labels).toEqual(["DCO", "creatives"]);
    expect(inv.counts.SZK).toEqual([1, 1]);
  });

  it("never reaches across clients", async () => {
    await audience(telekom.id, "t_aud", "TEL", null);
    await message(telekom.id, "t_aud", "TEL_topic", 1);
    const inv = await productInventory(erste.id);
    expect(inv.counts).toEqual({});
    expect(inv.options).toEqual([]);
  });

  // A product with no cells but with delivered files still has to be pickable.
  it("lists a product that only has creatives", async () => {
    await db
      .insert(creatives)
      .values({ clientId: erste.id, product: "HITEL", fileName: "x.png" });
    const inv = await productInventory(erste.id);
    expect(inv.options).toEqual(["HITEL"]);
    expect(inv.labels).toEqual(["creatives"]);
    expect(inv.counts.HITEL).toEqual([1]);
  });
});
