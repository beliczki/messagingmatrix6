import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { audiences, clients, creatives, messages } from "@/db/schema";
import {
  listStripCreatives,
  STRIP_PAGE,
  type StripPage,
} from "@/lib/dashboard-creatives";
import { resolveDayScope } from "@/lib/day-scope";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const NOW = new Date("2026-09-01T08:00:00Z");
const today = resolveDayScope("2026-09-01", "day", NOW);

type Row = {
  name: string;
  size?: string;
  createdAt?: string;
  updatedAt: string;
  mcNumber?: number;
  mcVariant?: string;
};

async function seed(clientId: number, rows: Row[]) {
  for (const r of rows) {
    await db.insert(creatives).values({
      clientId,
      fileName: r.name,
      fileDimensions: r.size ?? "300x250",
      createdAt: r.createdAt ?? r.updatedAt,
      updatedAt: r.updatedAt,
      mcNumber: r.mcNumber ?? null,
      mcVariant: r.mcVariant ?? null,
    });
  }
}

const names = (p: StripPage) =>
  p.items.map((i) => (i.kind === "uploaded" ? i.creative.fileName : i.mcLabel));

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

describe("dashboard creative strip", () => {
  // The live library's highest ids carry a years-old createdAt, so neither id
  // nor createdAt orders the strip the way "latest change" reads.
  it("orders by updatedAt, not by insertion id or createdAt", async () => {
    await seed(erste.id, [
      { name: "old-change.png", createdAt: "2026-08-30 09:00:00", updatedAt: "2026-08-30 09:00:00" },
      {
        name: "new-change-but-oldest-file.png",
        createdAt: "2025-12-22 10:00:00",
        updatedAt: "2026-08-31 09:00:00",
      },
    ]);
    expect(names(await listStripCreatives(erste.id, today))).toEqual([
      "new-change-but-oldest-file.png",
      "old-change.png",
    ]);
  });

  it("shows only 300x250 and 1080x1080", async () => {
    await seed(erste.id, [
      { name: "banner.png", size: "300x250", updatedAt: "2026-08-30 09:00:03" },
      { name: "square.png", size: "1080x1080", updatedAt: "2026-08-30 09:00:02" },
      { name: "skyscraper.png", size: "300x600", updatedAt: "2026-08-30 09:00:01" },
      { name: "leaderboard.png", size: "970x250", updatedAt: "2026-08-30 09:00:00" },
    ]);
    const page = await listStripCreatives(erste.id, today);
    expect(names(page)).toEqual(["banner.png", "square.png"]);
    expect(page.total).toBe(2);
  });

  it("collapses a version family to its newest member", async () => {
    await seed(erste.id, [
      { name: "ERSTE_SZK_MC1_a_thing_n1_300x250.png", updatedAt: "2026-08-30 09:00:01" },
      { name: "ERSTE_SZK_MC1_a_thing_n2_300x250.png", updatedAt: "2026-08-30 09:00:00" },
    ]);
    expect(names(await listStripCreatives(erste.id, today))).toEqual([
      "ERSTE_SZK_MC1_a_thing_n2_300x250.png",
    ]);
  });

  it("labels a tile with the topic of its MC", async () => {
    await seed(erste.id, [
      { name: "mc7.png", updatedAt: "2026-08-30 09:00:00", mcNumber: 7, mcVariant: "a" },
    ]);
    await db.insert(messages).values({
      clientId: erste.id,
      number: 7,
      variant: "a",
      audience: "aud",
      topic: "SZK_topic",
    });
    const page = await listStripCreatives(erste.id, today);
    expect(page.items[0]!.topic).toBe("SZK_topic");
  });

  it("uses the window when it holds a change, and says so", async () => {
    await seed(erste.id, [
      { name: "changed-today.png", updatedAt: "2026-09-01 07:00:00" },
      { name: "changed-earlier.png", updatedAt: "2026-08-13 09:00:00" },
    ]);
    const page = await listStripCreatives(erste.id, today);
    expect(page.fallback).toBe(false);
    expect(names(page)).toEqual(["changed-today.png"]);
  });

  it("pages to the end and then stops", async () => {
    await seed(
      erste.id,
      Array.from({ length: STRIP_PAGE + 5 }, (_, i) => ({
        name: `c${i}.png`,
        updatedAt: `2026-08-30 09:${String(i).padStart(2, "0")}:00`,
      })),
    );
    const first = await listStripCreatives(erste.id, today);
    expect(first.fallback).toBe(true);
    expect(first.items).toHaveLength(STRIP_PAGE);
    expect(first.nextOffset).toBe(STRIP_PAGE);
    const second = await listStripCreatives(erste.id, today, first.nextOffset!);
    expect(second.items).toHaveLength(5);
    expect(second.nextOffset).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The user's "DCO creatives" — matrix cells rendered live through their
  // template — belong in the same list as delivered files, on one recency line.
  it("mixes DCO matrix banners into the same recency order", async () => {
    await seed(erste.id, [
      { name: "older-file.png", updatedAt: "2026-08-30 08:00:00" },
      { name: "newer-file.png", updatedAt: "2026-08-30 10:00:00" },
    ]);
    await db.insert(messages).values({
      clientId: erste.id,
      number: 331,
      variant: "a",
      audience: "aud",
      topic: "SZK_topic",
      template: "html",
      status: "ACTIVE",
      updatedAt: "2026-08-30 09:00:00",
    });
    const page = await listStripCreatives(erste.id, today);
    expect(names(page)).toEqual(["newer-file.png", "MC331a", "older-file.png"]);
    const mc = page.items.find((i) => i.kind === "mc");
    expect(mc).toBeDefined();
    if (mc?.kind === "mc") {
      expect(mc.size).toBe("300x250");
      expect(mc.topic).toBe("SZK_topic");
      // Negative, so one id space holds both kinds — the Creative Library's
      // own scheme.
      expect(mc.id).toBeLessThan(0);
    }
  });

  it("leaves out cells the Creative Library would not show either", async () => {
    await db.insert(messages).values([
      {
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "aud",
        topic: "t",
        template: "html",
        status: "INCOMING",
        updatedAt: "2026-08-30 09:00:00",
      },
      {
        clientId: erste.id,
        number: 2,
        variant: "a",
        audience: "aud",
        topic: "t",
        template: null,
        status: "ACTIVE",
        updatedAt: "2026-08-30 09:00:00",
      },
    ]);
    expect((await listStripCreatives(erste.id, today)).items).toEqual([]);
  });

  // One MC lives in as many cells as it has audiences; without the collapse a
  // single edited MC would fill the strip with copies of itself.
  it("shows an MC once, however many cells carry it", async () => {
    for (const audience of ["aud_a", "aud_b", "aud_c"]) {
      await db.insert(messages).values({
        clientId: erste.id,
        number: 331,
        variant: "a",
        audience,
        topic: "SZK_topic",
        template: "html",
        status: "ACTIVE",
        updatedAt: "2026-08-30 09:00:00",
      });
    }
    const page = await listStripCreatives(erste.id, today);
    expect(names(page)).toEqual(["MC331a"]);
    expect(page.total).toBe(1);
  });

  it("never reaches across clients", async () => {
    await seed(telekom.id, [{ name: "telekom.png", updatedAt: "2026-08-13 09:00:00" }]);
    const page = await listStripCreatives(erste.id, today);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("leaves archived creatives out", async () => {
    await seed(erste.id, [{ name: "live.png", updatedAt: "2026-09-01 07:00:00" }]);
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "archived.png",
      fileDimensions: "300x250",
      createdAt: "2026-09-01 07:30:00",
      updatedAt: "2026-09-01 07:30:00",
      archivedAt: "2026-09-01 07:40:00",
    });
    expect(names(await listStripCreatives(erste.id, today))).toEqual(["live.png"]);
  });
});

describe("dashboard creative strip — product filter", () => {
  it("narrows both sources, each through its own product link", async () => {
    await db.insert(audiences).values([
      { clientId: erste.id, key: "szk_aud", name: "szk", product: "SZK", orderIndex: 0 },
      { clientId: erste.id, key: "val_aud", name: "val", product: "VAL", orderIndex: 0 },
    ]);
    await db.insert(messages).values([
      {
        clientId: erste.id,
        number: 1,
        variant: "a",
        audience: "szk_aud",
        topic: "SZK_t",
        template: "html",
        status: "ACTIVE",
        updatedAt: "2026-08-30 09:00:00",
      },
      {
        clientId: erste.id,
        number: 2,
        variant: "a",
        audience: "val_aud",
        topic: "VAL_t",
        template: "html",
        status: "ACTIVE",
        updatedAt: "2026-08-30 09:00:01",
      },
    ]);
    await db.insert(creatives).values([
      {
        clientId: erste.id,
        product: "SZK",
        fileName: "szk.png",
        fileDimensions: "300x250",
        updatedAt: "2026-08-30 09:00:02",
      },
      {
        clientId: erste.id,
        product: "VAL",
        fileName: "val.png",
        fileDimensions: "300x250",
        updatedAt: "2026-08-30 09:00:03",
      },
    ]);

    const all = await listStripCreatives(erste.id, today);
    expect(names(all)).toEqual(["val.png", "szk.png", "MC2a", "MC1a"]);

    // A creative carries its own product column; a cell's product hangs off
    // its audience — one filter, two different paths to it.
    const szk = await listStripCreatives(erste.id, today, 0, STRIP_PAGE, ["SZK"]);
    expect(names(szk)).toEqual(["szk.png", "MC1a"]);
    expect(szk.total).toBe(2);
  });
});
