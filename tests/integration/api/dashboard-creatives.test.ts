import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, creatives } from "@/db/schema";
import { listStripCreatives, STRIP_PAGE } from "@/lib/dashboard-creatives";
import { resolveDayScope } from "@/lib/day-scope";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const NOW = new Date("2026-09-01T08:00:00Z");
const today = resolveDayScope("2026-09-01", "day", NOW);
const week = resolveDayScope("2026-09-01", "7d", NOW);

async function seed(
  clientId: number,
  rows: Array<{ name: string; createdAt: string }>,
) {
  for (const r of rows) {
    await db
      .insert(creatives)
      .values({ clientId, fileName: r.name, createdAt: r.createdAt });
  }
}

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
  // The live library's highest ids carry a 2025-12-22 createdAt, so id order
  // put the oldest batch at the front of a strip labelled "new creatives".
  it("orders by createdAt, not by insertion id", async () => {
    await seed(erste.id, [
      { name: "new.png", createdAt: "2026-08-13 09:00:00" },
      { name: "old-but-inserted-last.png", createdAt: "2025-12-22 10:00:00" },
    ]);
    const page = await listStripCreatives(erste.id, today);
    expect(page.fallback).toBe(true);
    expect(page.items.map((i) => i.fileName)).toEqual([
      "new.png",
      "old-but-inserted-last.png",
    ]);
  });

  it("uses the window when it holds something, and says so", async () => {
    await seed(erste.id, [
      { name: "in-window.png", createdAt: "2026-09-01 07:00:00" },
      { name: "older.png", createdAt: "2026-08-13 09:00:00" },
    ]);
    const page = await listStripCreatives(erste.id, today);
    expect(page.fallback).toBe(false);
    expect(page.total).toBe(1);
    expect(page.items.map((i) => i.fileName)).toEqual(["in-window.png"]);
    // Widening the window pulls the older one in too.
    expect((await listStripCreatives(erste.id, week)).total).toBe(1);
  });

  it("pages to the end and then stops", async () => {
    await seed(
      erste.id,
      Array.from({ length: STRIP_PAGE + 5 }, (_, i) => ({
        name: `c${i}.png`,
        createdAt: `2026-08-${String(10 + (i % 3)).padStart(2, "0")} 09:00:00`,
      })),
    );
    const first = await listStripCreatives(erste.id, today);
    expect(first.items).toHaveLength(STRIP_PAGE);
    expect(first.nextOffset).toBe(STRIP_PAGE);
    const second = await listStripCreatives(erste.id, today, first.nextOffset!);
    expect(second.items).toHaveLength(5);
    expect(second.nextOffset).toBeNull();
    // No row is served twice across the two pages.
    const ids = [...first.items, ...second.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never reaches across clients", async () => {
    await seed(telekom.id, [{ name: "telekom.png", createdAt: "2026-08-13 09:00:00" }]);
    const page = await listStripCreatives(erste.id, today);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("leaves archived creatives out", async () => {
    await seed(erste.id, [{ name: "live.png", createdAt: "2026-09-01 07:00:00" }]);
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "archived.png",
      createdAt: "2026-09-01 07:30:00",
      archivedAt: "2026-09-01 07:40:00",
    });
    const page = await listStripCreatives(erste.id, today);
    expect(page.items.map((i) => i.fileName)).toEqual(["live.png"]);
  });
});
