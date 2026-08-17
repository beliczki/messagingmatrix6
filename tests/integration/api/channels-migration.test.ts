import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { audiences, channels, clients, topics } from "@/db/schema";
import { createMessage, listMessages } from "@/lib/entities/messages";
import {
  archiveChannel,
  channelToAudience,
  createChannel,
  listChannels,
  migrateChannelsFromAudiences,
  updateChannel,
} from "@/lib/entities/channels";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const CH = [
  { key: "ch_disp", code: "DISP", name: "Display" },
  { key: "ch_soc", code: "SOC", name: "Social" },
  { key: "ch_prg", code: "PRG", name: "Programmatic" },
];

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  // Legacy channel-audiences (channel != null) + a nonDCO topic.
  await db.insert(audiences).values(
    CH.map((c, i) => ({
      clientId: erste.id,
      key: c.key,
      name: c.name,
      orderIndex: 10 + i,
      channel: c.code,
    })),
  );
  await db.insert(topics).values({
    clientId: erste.id,
    key: "Loans_rate",
    name: "rate",
    orderIndex: 0,
    product: "Loans",
  });
});

afterEach(async () => {
  await h.cleanup();
});

describe("channels migration — channel-audiences → channels table", () => {
  it("seeds channels, deletes the channel-audiences, and keeps nonDCO messages", async () => {
    // Two nonDCO MCs created the real way (audience = channel key) while the
    // channel-audiences still exist.
    const a = await createMessage(erste.id, {
      audience: "ch_disp",
      topic: "Loans_rate",
      image1: "x.jpg",
    });
    const b = await createMessage(erste.id, {
      audience: "ch_soc",
      topic: "Loans_rate",
      image1: "y.jpg",
    });

    const res = await migrateChannelsFromAudiences(erste.id);
    expect(res).toEqual({ seeded: 3, deleted: 3 });

    // Channels table now authoritative.
    const chs = await listChannels(erste.id);
    expect(chs.map((c) => c.key).sort()).toEqual(["ch_disp", "ch_prg", "ch_soc"]);
    const disp = chs.find((c) => c.key === "ch_disp")!;
    expect(disp.code).toBe("DISP");
    expect(disp.label).toBe("Display");

    // Audiences list is DCO-only (no channel rows left).
    const leftover = await db
      .select()
      .from(audiences)
      .where(and(eq(audiences.clientId, erste.id), isNotNull(audiences.channel)));
    expect(leftover).toHaveLength(0);

    // The nonDCO messages survive untouched, still keyed by the channel string.
    const msgs = await listMessages(erste.id);
    const survivors = msgs.filter((m) => m.audience === "ch_disp" || m.audience === "ch_soc");
    expect(survivors.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(survivors.every((m) => m.image1 && m.template == null)).toBe(true);
  });

  it("after migration, createMessage resolves a channel key and numbers it on the nonDCO axis", async () => {
    // A DCO MC first (real audience), so DCO#1 exists.
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "aud1",
      name: "AUD1",
      orderIndex: 0,
      product: "Loans",
    });
    const dco = await createMessage(erste.id, {
      audience: "aud1",
      topic: "Loans_rate",
    });
    expect(dco.number).toBe(1);

    await migrateChannelsFromAudiences(erste.id);

    // Channel key no longer an audience — createMessage must fall back to the
    // channels table and place it on the nonDCO axis.
    const nondco = await createMessage(erste.id, {
      audience: "ch_disp",
      topic: "Loans_rate",
      image1: "z.jpg",
    });
    expect(nondco.template).toBeNull();
    // nonDCO numbering is an independent space — it may reuse #1 (axis-scoped),
    // which is exactly the DCO/nonDCO twin case, not a collision.
    expect(nondco.audience).toBe("ch_disp");
    expect(nondco.number).toBe(1);
  });

  it("is idempotent — a second run is a no-op", async () => {
    await migrateChannelsFromAudiences(erste.id);
    const again = await migrateChannelsFromAudiences(erste.id);
    expect(again).toEqual({ seeded: 0, deleted: 0 });
    expect(await listChannels(erste.id)).toHaveLength(3);
  });

  it("CRUD: create appends order, update patches, archive hides from the default list", async () => {
    const a = await createChannel(erste.id, { key: "ch_x", code: "X", label: "X" });
    const b = await createChannel(erste.id, { key: "ch_y", code: "Y", label: "Y" });
    expect(b.orderIndex).toBe(a.orderIndex + 1);

    const upd = await updateChannel(erste.id, a.id, { label: "X-renamed" });
    expect(upd?.label).toBe("X-renamed");

    await archiveChannel(erste.id, b.id);
    const active = await listChannels(erste.id);
    expect(active.map((c) => c.key)).toEqual(["ch_x"]);
    expect((await listChannels(erste.id, { includeArchived: true })).length).toBe(2);
  });

  it("channelToAudience presents a channel on the nonDCO axis (channel = code)", async () => {
    await migrateChannelsFromAudiences(erste.id);
    const [disp] = (await listChannels(erste.id)).filter((c) => c.key === "ch_disp");
    const aud = channelToAudience(disp);
    expect(aud.channel).toBe("DISP"); // non-null ⇒ nonDCO
    expect(aud.key).toBe("ch_disp");
    expect(aud.product).toBeNull();
  });
});
