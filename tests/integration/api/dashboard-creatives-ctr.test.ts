import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, creatives, messages, monitoring } from "@/db/schema";
import {
  CTR_MIN_IMPRESSIONS,
  listStripCreatives,
  type StripPage,
} from "@/lib/dashboard-creatives";
import { resolveDayScope } from "@/lib/day-scope";
import { createTestDb, type TestDb } from "../../helpers/test-db";

// The strip's second ordering ranks by measured click-through instead of by
// recency. Three rules ride on it: only matched reporting counts, an MC under
// the impression floor has no rate worth ranking, and the day window does not
// apply — a rate is a property of the whole run.

let h: TestDb;
let erste: { id: number };

const NOW = new Date("2026-09-01T08:00:00Z");
const today = resolveDayScope("2026-09-01", "day", NOW);

const names = (p: StripPage) =>
  p.items.map((i) => (i.kind === "uploaded" ? i.creative.fileName : i.mcLabel));

/** An uploaded creative on an MC, changed on `updatedAt`. */
async function creative(
  name: string,
  mcNumber: number,
  updatedAt = "2026-09-01 09:00:00",
) {
  await db.insert(creatives).values({
    clientId: erste.id,
    fileName: name,
    fileDimensions: "300x250",
    mcNumber,
    mcVariant: "a",
    createdAt: updatedAt,
    updatedAt,
  });
}

/**
 * Reporting for an MC: `impressions` and `clicks`, matched unless told not to.
 * "Matched" is a resolved `message_id` — the same thing the monitoring table's
 * own Matched/Unmatched filter means — so a matched row needs a real message.
 * These messages carry no template, so they never surface as strip tiles of
 * their own and only the uploaded creatives are ranked here.
 */
async function reported(
  mcNumber: number,
  impressions: number,
  clicks: number,
  matched = true,
  period: [string, string] = ["01/08/2026 00:00:00", "31/08/2026 23:59:59"],
) {
  let messageId: number | null = null;
  if (matched) {
    const [m] = await db
      .insert(messages)
      .values({
        clientId: erste.id,
        number: mcNumber,
        variant: "a",
        audience: `AUD_${mcNumber}`,
        topic: `topic_${mcNumber}`,
      })
      .returning();
    messageId = m.id;
  }
  await db.insert(monitoring).values({
    clientId: erste.id,
    platform: "adform",
    audienceKey: `AUD_${mcNumber}`,
    topicKey: `topic_${mcNumber}`,
    mcNumber,
    mcVariant: "a",
    size: "300x250",
    impressions,
    clicks,
    messageId,
    matchLevel: matched ? "exact" : null,
    periodFrom: period[0],
    periodTo: period[1],
  });
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

describe("creative strip ordered by CTR", () => {
  it("ranks by measured rate, best first", async () => {
    await creative("low.png", 1);
    await creative("high.png", 2);
    await creative("mid.png", 3);
    // Deliberately not in delivery order: volume must not decide the ranking.
    await reported(1, 1_000_000, 1_000); // 0.10%
    await reported(2, 200_000, 2_000); // 1.00%
    await reported(3, 500_000, 2_500); // 0.50%

    const page = await listStripCreatives(erste.id, today, 0, 24, [], "ctr");
    expect(names(page)).toEqual(["high.png", "mid.png", "low.png"]);
  });

  it("drops an MC that has not delivered enough to have a rate", async () => {
    await creative("thin.png", 1);
    await creative("solid.png", 2);
    await reported(1, CTR_MIN_IMPRESSIONS - 1, 5_000); // huge rate, no volume
    await reported(2, CTR_MIN_IMPRESSIONS, 100);

    const page = await listStripCreatives(erste.id, today, 0, 24, [], "ctr");
    expect(names(page)).toEqual(["solid.png"]);
    expect(page.total).toBe(1);
  });

  it("counts matched reporting only", async () => {
    await creative("matched.png", 1);
    await creative("unmatched.png", 2);
    await reported(1, 200_000, 400);
    await reported(2, 900_000, 90_000, false); // unattributable, however good

    const page = await listStripCreatives(erste.id, today, 0, 24, [], "ctr");
    expect(names(page)).toEqual(["matched.png"]);
  });

  it("sums an MC's periods before applying the floor", async () => {
    await creative("split.png", 1);
    // Neither period clears 100k alone; together they do.
    await reported(1, 60_000, 600);
    await reported(1, 60_000, 600, true, [
      "01/07/2026 00:00:00",
      "31/07/2026 23:59:59",
    ]);

    const page = await listStripCreatives(erste.id, today, 0, 24, [], "ctr");
    expect(names(page)).toEqual(["split.png"]);
  });

  it("ignores the day window, unlike the time ordering", async () => {
    // Changed months ago: invisible to a one-day window, but its rate stands.
    await creative("old-but-good.png", 1, "2026-05-02 09:00:00");
    await reported(1, 300_000, 3_000);

    expect(names(await listStripCreatives(erste.id, today, 0, 24, [], "ctr")))
      .toEqual(["old-but-good.png"]);
    const byTime = await listStripCreatives(erste.id, today);
    expect(byTime.fallback).toBe(true); // nothing in the window, so: latest list
  });

  it("never claims a window fallback while ranking by CTR", async () => {
    await creative("a.png", 1, "2026-05-02 09:00:00");
    await reported(1, 300_000, 3_000);
    const page = await listStripCreatives(erste.id, today, 0, 24, [], "ctr");
    expect(page.fallback).toBe(false);
  });

  it("still honours the product filter", async () => {
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "szk.png",
      fileDimensions: "300x250",
      product: "SZK",
      mcNumber: 1,
      mcVariant: "a",
      createdAt: "2026-09-01 09:00:00",
      updatedAt: "2026-09-01 09:00:00",
    });
    await db.insert(creatives).values({
      clientId: erste.id,
      fileName: "hk.png",
      fileDimensions: "300x250",
      product: "HK",
      mcNumber: 2,
      mcVariant: "a",
      createdAt: "2026-09-01 09:00:00",
      updatedAt: "2026-09-01 09:00:00",
    });
    await reported(1, 200_000, 400);
    await reported(2, 200_000, 4_000);

    const page = await listStripCreatives(
      erste.id,
      today,
      0,
      24,
      ["SZK"],
      "ctr",
    );
    expect(names(page)).toEqual(["szk.png"]);
  });

  it("leaves the time ordering untouched", async () => {
    await creative("newer.png", 1, "2026-09-01 10:00:00");
    await creative("older.png", 2, "2026-09-01 09:00:00");
    await reported(1, 200_000, 200); // 0.10%
    await reported(2, 200_000, 4_000); // 2.00% — would lead on CTR

    expect(names(await listStripCreatives(erste.id, today))).toEqual([
      "newer.png",
      "older.png",
    ]);
  });
});
