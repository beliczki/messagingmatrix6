import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import xlsx from "node-xlsx";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { clients, monitoring, users } from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";
import { POST as importPOST } from "@/app/api/monitoring/import/route";

// Route-LEVEL test for the AdForm report import. The parser has its own unit
// tests; what only shows up here is the write side — a monitoring row spends 20
// bind parameters and Postgres caps a statement at 65534, so a single-statement
// insert dies with MAX_PARAMETERS_EXCEEDED above 3276 rows. A real month of
// AdForm data clears that (Aug 2026 aggregated to 5785 rows), so the insert has
// to be chunked. This test would fail against the pre-fix single-statement code.

let h: TestDb;
let erste: { id: number };

// Aggregated rows per report. Above the 3276-row single-statement ceiling, and
// deliberately not a multiple of the chunk size so a truncated last chunk shows.
const KEYS = 3500;

function buildReport(keys: number): Buffer {
  const front = [
    ["", "Summary"],
    ["", "Reporting Period From", "01/08/2026 00:00:00"],
    ["", "Reporting Period To", "31/08/2026 23:59:59"],
  ];
  const sheet: unknown[][] = [
    ["", "Table"],
    [
      "",
      "Date",
      "Banner/Adgroups",
      "Cost",
      "Clicks",
      "Conversions",
      "Rendered Impressions",
    ],
  ];
  for (let i = 0; i < keys; i += 1) {
    sheet.push([
      "",
      "01/08/2026",
      `Camp - Ban 300x250 - p_adform-s_pro-a_aud_${i}-m_${i}-t_topic_${i}-v_a-n_1-l_1`,
      10,
      2,
      0,
      100,
    ]);
  }
  return xlsx.build([
    { name: "Front Page", data: front, options: {} },
    { name: "Sheet", data: sheet, options: {} },
  ]) as Buffer;
}

function uploadReq(token: string, buffer: Buffer, filename: string): NextRequest {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buffer)], filename));
  return {
    url: "http://localhost/api/monitoring/import",
    headers: new Headers({ authorization: `Bearer ${token}` }),
    cookies: { get: () => undefined },
    formData: async () => form,
  } as unknown as NextRequest;
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

async function adminToken() {
  const [u] = await db.select().from(users).limit(1);
  return signSession(u);
}

describe("POST /api/monitoring/import", () => {
  it("imports a report that exceeds the single-statement parameter ceiling", async () => {
    const res = await importPOST(
      uploadReq(await adminToken(), buildReport(KEYS), "Creative rep_08_2026.xlsx"),
      {},
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.imported).toBe(KEYS);
    expect(body.periodFrom).toBe("01/08/2026 00:00:00");

    const rows = await db
      .select()
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id));
    expect(rows).toHaveLength(KEYS);
  });

  it("replaces the whole period slice on re-upload, never doubling it", async () => {
    const token = await adminToken();
    await importPOST(uploadReq(token, buildReport(KEYS), "a.xlsx"), {});
    await importPOST(uploadReq(token, buildReport(KEYS), "b.xlsx"), {});

    const rows = await db
      .select()
      .from(monitoring)
      .where(eq(monitoring.clientId, erste.id));
    expect(rows).toHaveLength(KEYS);
    expect(rows.every((r) => r.sourceFilename === "b.xlsx")).toBe(true);
  });
});
