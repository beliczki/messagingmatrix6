import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { asc, eq } from "drizzle-orm";
import xlsx from "node-xlsx";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, monitoring, users } from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import { monthlyDelivery } from "@/lib/dashboard-monitoring";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { POST as importPOST } from "@/app/api/monitoring/import/route";
import { GET as monitoringGET } from "@/app/api/monitoring/route";

// The AdForm report has always carried a per-day `Date` column; the importer
// used to fold it away into one whole-period row per message key. These tests
// pin the two halves of that change: the day now survives into the table, and
// every existing reader still reports the same period totals over it.

let h: TestDb;
let erste: { id: number };

const FRONT = [
  ["", "Summary"],
  ["", "Reporting Period From", "01/08/2026 00:00:00"],
  ["", "Reporting Period To", "31/08/2026 23:59:59"],
];

/** `keys` message keys x `days` days, 100 impressions and 2 clicks per row. */
function report(keys: number, days: string[], withDateColumn = true): Buffer {
  const header = withDateColumn
    ? ["", "Date", "Banner/Adgroups", "Cost", "Clicks", "Conversions", "Rendered Impressions"]
    : ["", "Banner/Adgroups", "Cost", "Clicks", "Conversions", "Rendered Impressions"];
  const sheet: unknown[][] = [["", "Table"], header];
  for (const day of days) {
    for (let i = 0; i < keys; i += 1) {
      const bag = `Camp - Ban 300x250 - p_adform-s_pro-a_aud_${i}-m_${i}-t_topic_${i}-v_a-n_1-l_1`;
      sheet.push(
        withDateColumn
          ? ["", day, bag, 10, 2, 0, 100]
          : ["", bag, 10, 2, 0, 100],
      );
    }
  }
  return xlsx.build([
    { name: "Front Page", data: FRONT, options: {} },
    { name: "Sheet", data: sheet, options: {} },
  ]) as Buffer;
}

async function upload(buffer: Buffer, filename = "Creative rep_08_2026.xlsx") {
  const [u] = await db.select().from(users).limit(1);
  const token = await signSession(u);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buffer)], filename));
  const req = {
    url: "http://localhost/api/monitoring/import",
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
    formData: async () => form,
  } as unknown as NextRequest;
  const res = await importPOST(req, {});
  expect(res.status).toBe(200);
  return JSON.parse(await res.text());
}

async function readBack() {
  const [u] = await db.select().from(users).limit(1);
  const token = await signSession(u);
  const req = {
    url: "http://localhost/api/monitoring",
    nextUrl: new URL("http://localhost/api/monitoring"),
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
  } as unknown as NextRequest;
  const res = await monitoringGET(req, {});
  return JSON.parse(await res.text());
}

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
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

describe("monitoring day grain", () => {
  it("keeps one row per key per day, normalized to ISO", async () => {
    const body = await upload(report(2, ["01/08/2026", "02/08/2026", "03/08/2026"]));
    expect(body.imported).toBe(6); // 2 keys x 3 days, not 2

    const days = await db
      .selectDistinct({ day: monitoring.day })
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id))
      .orderBy(asc(monitoring.day));
    expect(days.map((d) => d.day)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("still imports a report with no Date column, folding the period whole", async () => {
    const body = await upload(report(2, ["01/08/2026", "02/08/2026"], false));
    expect(body.imported).toBe(2); // both days folded into one row per key

    const rows = await db
      .select({ day: monitoring.day, impressions: monitoring.impressions })
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id));
    expect(rows.every((r) => r.day === "")).toBe(true);
    expect(rows.every((r) => r.impressions === 200)).toBe(true);
  });

  it("leaves no mixed-grain remnant when a folded period is re-uploaded per day", async () => {
    await upload(report(2, ["01/08/2026", "02/08/2026"], false));
    await upload(report(2, ["01/08/2026", "02/08/2026"]));

    const rows = await db
      .select({ day: monitoring.day })
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id));
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.day === "")).toBe(false);
  });

  it("reports the same period totals as the folded import did", async () => {
    // The point of the slice: readers group by period, so splitting a period
    // into days must not move a single number they show.
    await upload(report(3, ["01/08/2026", "02/08/2026"], false));
    const foldedDelivery = await monthlyDelivery(erste.id);
    const foldedRoute = await readBack();

    await upload(report(3, ["01/08/2026", "02/08/2026"]));
    const dayDelivery = await monthlyDelivery(erste.id);
    const dayRoute = await readBack();

    expect(dayDelivery).toEqual(foldedDelivery);
    expect(dayDelivery[0]).toMatchObject({ impressions: 600, clicks: 12 });

    // Same rows, same numbers — only the stored id moves, since the row the
    // aggregate names is now the first of that key's days.
    expect(dayRoute.rows).toHaveLength(foldedRoute.rows.length);
    expect(
      dayRoute.rows.map((r: { mcNumber: number; impressions: number }) => [
        r.mcNumber,
        r.impressions,
      ]),
    ).toEqual(
      foldedRoute.rows.map((r: { mcNumber: number; impressions: number }) => [
        r.mcNumber,
        r.impressions,
      ]),
    );
    expect(dayRoute.mcTrend).toEqual(foldedRoute.mcTrend);
  });
});
