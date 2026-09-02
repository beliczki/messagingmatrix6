import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import {
  assets,
  audiences,
  auditLog,
  clients,
  messages,
  topics,
} from "@/db/schema";
import { activityDigest } from "@/lib/dashboard-activity";
import type { DayScope } from "@/lib/day-scope";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let other: { id: number };

const SCOPE: DayScope = {
  date: "2026-09-01",
  range: "7d",
  from: "2026-08-26 00:00:00",
  to: "2026-09-01 23:59:59",
  label: "26 Aug – 1 Sept",
};

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

function write(
  entityType: string,
  entityId: string,
  over: Partial<typeof auditLog.$inferInsert> = {},
) {
  return db.insert(auditLog).values({
    clientId: erste.id,
    entityType,
    entityId,
    action: "update",
    userId: "u1",
    createdAt: "2026-08-28 10:00:00",
    ...over,
  });
}

/** Digest rows collapsed to "entity:action" -> count, which is what the panel renders. */
async function digest(products: string[]) {
  const rows = await activityDigest(erste.id, SCOPE, products);
  return Object.fromEntries(
    rows.map((r) => [`${r.entityType}:${r.action}`, r.n]),
  );
}

describe("activityDigest product filter", () => {
  it("keeps only the selected product's entities", async () => {
    await db.insert(audiences).values([
      { clientId: erste.id, key: "SZK_x", name: "SZK x", orderIndex: 1, product: "SZK" },
      { clientId: erste.id, key: "HK_x", name: "HK x", orderIndex: 2, product: "HK" },
    ]);
    const inserted = await db
      .insert(messages)
      .values([
        { clientId: erste.id, number: 1, variant: "a", audience: "SZK_x", topic: "SZK_topic" },
        { clientId: erste.id, number: 2, variant: "a", audience: "HK_x", topic: "HK_topic" },
      ])
      .returning();

    for (const m of inserted) await write("messages", String(m.id));

    expect(await digest([])).toEqual({ "messages:update": 2 });
    expect(await digest(["SZK"])).toEqual({ "messages:update": 1 });
    expect(await digest(["SZK", "HK"])).toEqual({ "messages:update": 2 });
    expect(await digest(["VAL"])).toEqual({});
  });

  it("resolves a nonDCO channel cell from its topic prefix", async () => {
    // nonDCO cells store a channel key (`ch_disp`, `ch_soc`) in
    // `messages.audience`. Channels are their own table and carry no product,
    // so the topic key prefix is the only thing that names one. 688 Erste
    // cells are nonDCO.
    const [m] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 3,
        variant: "a",
        audience: "ch_disp",
        topic: "HITEL_babavaro_callToAction",
      })
      .returning();
    await write("messages", String(m.id));

    expect(await digest(["HITEL"])).toEqual({ "messages:update": 1 });
    expect(await digest(["SZK"])).toEqual({});
  });

  it("drops entity types that have no product while a filter is on", async () => {
    const [asset] = await db
      .insert(assets)
      .values({ clientId: erste.id, product: "SZK" })
      .returning();
    await write("assets", String(asset.id), { action: "create" });
    await write("text_formatting", "7");
    await write("config", "defaultTemplate");
    await write("uploaded_files", "3j4ILQN_x2bn0AVfRYmF1", { action: "create" });

    expect(await digest([])).toEqual({
      "assets:create": 1,
      "text_formatting:update": 1,
      "config:update": 1,
      "uploaded_files:create": 1,
    });
    expect(await digest(["SZK"])).toEqual({ "assets:create": 1 });
  });

  it("survives a non-numeric entity_id while filtering", async () => {
    // `entity_id` is text and not always a number (nanoids, config keys), so
    // the join has to cast the id column to text — never the other way round.
    await write("share_galleries", "cf_cU6mgoWil", { action: "create" });
    await expect(digest(["SZK"])).resolves.toEqual({});
  });

  it("drops a deleted entity's row while a filter is on, keeps it without one", async () => {
    await write("messages", "999999", { action: "delete" });

    expect(await digest([])).toEqual({ "messages:delete": 1 });
    expect(await digest(["SZK"])).toEqual({});
  });

  it("takes a topic's product from its own column, falling back to the key", async () => {
    const inserted = await db
      .insert(topics)
      .values([
        { clientId: erste.id, key: "SZK_one", name: "One", orderIndex: 1, product: "SZK" },
        { clientId: erste.id, key: "VAL_two", name: "Two", orderIndex: 2 },
      ])
      .returning();
    for (const t of inserted) await write("topics", String(t.id));

    expect(await digest(["SZK"])).toEqual({ "topics:update": 1 });
    expect(await digest(["VAL"])).toEqual({ "topics:update": 1 });
  });

  it("still honours the day scope and the client", async () => {
    const [m] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: 4,
        variant: "a",
        audience: "ch_soc",
        topic: "SZK_topic",
      })
      .returning();
    await write("messages", String(m.id));
    await write("messages", String(m.id), { createdAt: "2026-07-01 10:00:00" });
    await write("messages", String(m.id), { clientId: other.id });

    expect(await digest(["SZK"])).toEqual({ "messages:update": 1 });
  });
});
