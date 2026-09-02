import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import {
  assets,
  audiences,
  clients,
  creatives,
  messages,
  textFormatting,
  topics,
} from "@/db/schema";
import { libraryCounts } from "@/lib/dashboard-products";
import { createTestDb, type TestDb } from "../../helpers/test-db";

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

  await db.insert(audiences).values([
    { clientId: erste.id, key: "SZK_x", name: "SZK x", orderIndex: 1, product: "SZK" },
    { clientId: erste.id, key: "HK_x", name: "HK x", orderIndex: 2, product: "HK" },
  ]);
  await db.insert(topics).values([
    { clientId: erste.id, key: "SZK_one", name: "One", orderIndex: 1, product: "SZK" },
    // no product column value — the key prefix has to name it
    { clientId: erste.id, key: "HK_two", name: "Two", orderIndex: 2 },
  ]);
  await db.insert(messages).values([
    { clientId: erste.id, number: 1, variant: "a", audience: "SZK_x", topic: "SZK_one" },
    { clientId: erste.id, number: 2, variant: "a", audience: "HK_x", topic: "HK_two" },
    // nonDCO: sits on a channel, so only the topic prefix names its product
    { clientId: erste.id, number: 3, variant: "a", audience: "ch_disp", topic: "SZK_one" },
  ]);
  await db.insert(assets).values([
    { clientId: erste.id, product: "SZK" },
    { clientId: erste.id, product: "HK" },
  ]);
  await db.insert(creatives).values([{ clientId: erste.id, product: "SZK" }]);
  await db.insert(textFormatting).values([
    { clientId: erste.id, textOriginal: "one", textFormatted: "<b>one</b>" },
    { clientId: erste.id, textOriginal: "two", textFormatted: "<b>two</b>" },
  ]);
});

afterEach(async () => {
  await h.cleanup();
});

describe("libraryCounts", () => {
  it("counts the whole library when no product is selected", async () => {
    expect(await libraryCounts(erste.id)).toEqual({
      audiences: 2,
      topics: 2,
      // three cells, but MC1a / MC2a / MC3a — three distinct MCs
      mcs: 3,
      messageCells: 3,
      assets: 2,
      creatives: 1,
      text_formatting: 2,
    });
  });

  it("narrows every product-bearing entity to the selection", async () => {
    expect(await libraryCounts(erste.id, ["SZK"])).toEqual({
      audiences: 1,
      topics: 1,
      // the DCO cell and the nonDCO channel cell, both on an SZK topic
      mcs: 2,
      messageCells: 2,
      assets: 1,
      creatives: 1,
      // no product dimension — deliberately unfiltered
      text_formatting: 2,
    });
  });

  it("counts an MC once however many cells it occupies", async () => {
    // The live shape this fixes: MC316a lives in 43 cells, and the row count
    // read as a library size of 2,753 against 635 actual MCs.
    await db.insert(messages).values([
      { clientId: erste.id, number: 9, variant: "a", audience: "SZK_x", topic: "SZK_one" },
      { clientId: erste.id, number: 9, variant: "a", audience: "HK_x", topic: "SZK_one" },
      // a second variant of the same number is its own MC
      { clientId: erste.id, number: 9, variant: "b", audience: "SZK_x", topic: "SZK_one" },
    ]);

    const all = await libraryCounts(erste.id);
    expect(all.messageCells).toBe(6); // 3 from the base fixture + 3 here
    expect(all.mcs).toBe(5); // MC1a, MC2a, MC3a, MC9a, MC9b
  });

  it("takes a topic's product from its key when the column is empty", async () => {
    const hk = await libraryCounts(erste.id, ["HK"]);
    expect(hk.topics).toBe(1);
    expect(hk.mcs).toBe(1);
  });

  it("adds up across a multi-product selection", async () => {
    const both = await libraryCounts(erste.id, ["SZK", "HK"]);
    expect(both).toMatchObject({ audiences: 2, topics: 2, mcs: 3, assets: 2 });
  });

  it("returns zeros for a product with nothing in the library", async () => {
    const val = await libraryCounts(erste.id, ["VAL"]);
    expect(val).toMatchObject({ audiences: 0, topics: 0, mcs: 0, creatives: 0 });
  });

  it("never counts another client's rows", async () => {
    await db
      .insert(audiences)
      .values({ clientId: other.id, key: "SZK_y", name: "y", orderIndex: 1, product: "SZK" });
    expect((await libraryCounts(erste.id, ["SZK"])).audiences).toBe(1);
  });
});
