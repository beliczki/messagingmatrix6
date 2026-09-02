import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, monitoring, users } from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { GET as monitoringGET } from "@/app/api/monitoring/route";

// Route-level test for the report-period RANGE. What only shows here is the
// cross-period aggregation: the same message key in three months has to come
// back as one row with summed metrics and a recomputed CTR, and the period
// list has to order on the parsed date rather than the stored DD/MM/YYYY text.

let h: TestDb;
let erste: { id: number };
let other: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [other] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
  await db.insert(users).values({
    id: "u-admin",
    clientId: erste.id,
    email: "admin@erste.test",
    password: await hashPassword("password123"),
    role: "admin",
  });
});

afterEach(async () => {
  await h.cleanup();
});

async function get(query = "") {
  const [u] = await db.select().from(users).limit(1);
  const token = await signSession(u);
  const req = {
    url: `http://localhost/api/monitoring${query}`,
    nextUrl: new URL(`http://localhost/api/monitoring${query}`),
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
  const res = await monitoringGET(req, {});
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

/** One monitoring row for the same message key in the given month. */
function row(
  month: string,
  over: Partial<typeof monitoring.$inferInsert> = {},
) {
  return {
    clientId: erste.id,
    platform: "adform",
    audienceKey: "SZK_x",
    topicKey: "SZK_topic",
    mcNumber: 1,
    mcVariant: "a",
    size: "300x250",
    impressions: 1000,
    clicks: 10,
    cost: 100,
    conversions: 1,
    periodFrom: `01/${month}/2026 00:00:00`,
    periodTo: `28/${month}/2026 23:59:59`,
    ...over,
  };
}

describe("GET /api/monitoring — report-period range", () => {
  it("defaults to the newest period alone", async () => {
    await db
      .insert(monitoring)
      .values([
        row("06", { impressions: 500 }),
        row("07", { impressions: 900 }),
      ]);

    const body = await get();
    expect(body.selected).toMatchObject({
      from: "01/07/2026 00:00:00",
      to: "01/07/2026 00:00:00",
      periods: 1,
    });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].impressions).toBe(900);
  });

  it("sums one message key across the selected periods", async () => {
    await db.insert(monitoring).values([
      row("05", { impressions: 100, clicks: 1, cost: 10, conversions: 1 }),
      row("06", { impressions: 200, clicks: 2, cost: 20, conversions: 2 }),
      row("07", { impressions: 300, clicks: 3, cost: 30, conversions: 3 }),
    ]);

    const body = await get(
      "?from=01/05/2026 00:00:00&to=01/07/2026 00:00:00",
    );
    expect(body.selected.periods).toBe(3);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      impressions: 600,
      clicks: 6,
      cost: 60,
      conversions: 6,
    });
  });

  it("recomputes CTR from the summed metrics, never averages the periods'", async () => {
    // A quiet month at 10% and a busy one at 1% average to 5.5%, but the true
    // combined rate is 1.09%. Averaging would weight them equally.
    await db.insert(monitoring).values([
      row("06", { impressions: 100, clicks: 10, ctr: 0.1 }),
      row("07", { impressions: 10000, clicks: 100, ctr: 0.01 }),
    ]);

    const body = await get(
      "?from=01/06/2026 00:00:00&to=01/07/2026 00:00:00",
    );
    expect(body.rows[0].ctr).toBeCloseTo(110 / 10100, 6);
  });

  it("spans the same slice whichever way round the markers come", async () => {
    await db
      .insert(monitoring)
      .values([row("05"), row("06"), row("07")]);

    const forward = await get(
      "?from=01/05/2026 00:00:00&to=01/07/2026 00:00:00",
    );
    const backward = await get(
      "?from=01/07/2026 00:00:00&to=01/05/2026 00:00:00",
    );
    expect(backward.selected).toEqual(forward.selected);
    expect(backward.rows[0].impressions).toBe(forward.rows[0].impressions);
  });

  it("keeps distinct keys apart while summing", async () => {
    await db.insert(monitoring).values([
      row("06", { impressions: 100 }),
      row("07", { impressions: 200 }),
      row("06", { mcNumber: 2, impressions: 50 }),
      row("07", { size: "300x600", impressions: 70 }),
    ]);

    const body = await get(
      "?from=01/06/2026 00:00:00&to=01/07/2026 00:00:00",
    );
    const byKey = Object.fromEntries(
      body.rows.map((r: { mcNumber: number; size: string; impressions: number }) => [
        `${r.mcNumber}|${r.size}`,
        r.impressions,
      ]),
    );
    expect(byKey).toEqual({ "1|300x250": 300, "2|300x250": 50, "1|300x600": 70 });
  });

  it("lists periods newest first across a year boundary", async () => {
    // "01/12/2025" sorts AFTER "01/01/2026" as text — ordering on the stored
    // string would put December at the top of the selector.
    await db.insert(monitoring).values([
      row("01", { impressions: 10 }),
      {
        ...row("12", { impressions: 20 }),
        periodFrom: "01/12/2025 00:00:00",
        periodTo: "31/12/2025 23:59:59",
      },
    ]);

    const body = await get();
    expect(body.periods.map((p: { periodFrom: string }) => p.periodFrom)).toEqual([
      "01/01/2026 00:00:00",
      "01/12/2025 00:00:00",
    ]);
    expect(body.selected.from).toBe("01/01/2026 00:00:00");
  });

  it("falls back to the newest period when a marker is unknown", async () => {
    await db.insert(monitoring).values([row("06"), row("07")]);

    const body = await get("?from=01/01/1999 00:00:00");
    expect(body.selected.periods).toBe(1);
    expect(body.selected.from).toBe("01/07/2026 00:00:00");
  });

  it("returns per-MC, per-period totals for the detail dialog", async () => {
    await db.insert(monitoring).values([
      row("06", { impressions: 100, clicks: 1 }),
      row("06", { size: "300x600", impressions: 40, clicks: 2 }),
      row("07", { impressions: 300, clicks: 3 }),
    ]);

    const body = await get(
      "?from=01/06/2026 00:00:00&to=01/07/2026 00:00:00",
    );
    // Sizes fold together here — the trend is per MC, per period.
    expect(
      body.mcTrend
        .slice()
        .sort((a: { periodFrom: string }, b: { periodFrom: string }) =>
          a.periodFrom.localeCompare(b.periodFrom),
        ),
    ).toEqual([
      {
        mcNumber: 1,
        mcVariant: "a",
        periodFrom: "01/06/2026 00:00:00",
        impressions: 140,
        clicks: 3,
      },
      {
        mcNumber: 1,
        mcVariant: "a",
        periodFrom: "01/07/2026 00:00:00",
        impressions: 300,
        clicks: 3,
      },
    ]);
  });

  it("never reads another client's periods", async () => {
    await db.insert(monitoring).values([
      row("07", { impressions: 100 }),
      { ...row("07", { impressions: 999999 }), clientId: other.id },
    ]);

    const body = await get();
    expect(body.periods).toHaveLength(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].impressions).toBe(100);
  });

  it("returns an empty payload when nothing was imported", async () => {
    const body = await get();
    expect(body).toEqual({
      periods: [],
      selected: null,
      rows: [],
      mcTrend: [],
    });
  });
});
