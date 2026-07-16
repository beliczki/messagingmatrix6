import { describe, it, expect, beforeEach, afterEach } from "vitest";
import xlsx from "node-xlsx";
import { db } from "@/db";
import { audiences, clients, messages, topics } from "@/db/schema";
import { exportMatrixXlsx } from "@/lib/export-xlsx";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

async function seedAudience(
  clientId: number,
  key: string,
  product: string | null,
  orderIndex: number,
) {
  await db.insert(audiences).values({
    clientId,
    key,
    name: key.toUpperCase(),
    orderIndex,
    product,
  });
}

async function seedTopic(
  clientId: number,
  key: string,
  product: string | null,
  orderIndex: number,
) {
  await db.insert(topics).values({
    clientId,
    key,
    name: key.toUpperCase(),
    orderIndex,
    product,
  });
}

async function seedMessage(
  clientId: number,
  fields: Partial<typeof messages.$inferInsert> & {
    number: number;
    variant: string;
    audience: string;
    topic: string;
  },
) {
  const [row] = await db
    .insert(messages)
    .values({ clientId, ...fields })
    .returning();
  return row!;
}

// Seeds: P1 with 2 audiences + 2 topics, P2 with 1 + 1.
// MC1a runs on both P1 audiences (sibling rows); MC2a is CONTENT status;
// MC3a on P2; MC4a archived; MC5a points at a dangling audience key.
async function seedMatrix() {
  await seedAudience(erste.id, "aud1", "P1", 0);
  await seedAudience(erste.id, "aud2", "P1", 1);
  await seedAudience(erste.id, "aud3", "P2", 2);
  await seedTopic(erste.id, "top1", "P1", 0);
  await seedTopic(erste.id, "top2", "P1", 1);
  await seedTopic(erste.id, "top3", "P2", 2);

  await seedMessage(erste.id, {
    number: 1,
    variant: "a",
    audience: "aud1",
    topic: "top1",
    status: "ACTIVE",
    pmmid: "PMM-1-aud1",
    landingUrl: "https://example.com/1",
    utmCampaign: "camp-aud1",
    finalTraffickedUrl: "https://example.com/1?utm=aud1",
    headline: "H1",
  });
  await seedMessage(erste.id, {
    number: 1,
    variant: "a",
    audience: "aud2",
    topic: "top1",
    status: "ACTIVE",
    pmmid: "PMM-1-aud2",
    landingUrl: "https://example.com/1",
    utmCampaign: "camp-aud2",
    finalTraffickedUrl: "https://example.com/1?utm=aud2",
    headline: "H1",
  });
  await seedMessage(erste.id, {
    number: 2,
    variant: "a",
    audience: "aud1",
    topic: "top1",
    status: "CONTENT",
  });
  await seedMessage(erste.id, {
    number: 3,
    variant: "a",
    audience: "aud3",
    topic: "top3",
    status: "ACTIVE",
  });
  await seedMessage(erste.id, {
    number: 4,
    variant: "a",
    audience: "aud1",
    topic: "top1",
    status: "ACTIVE",
    archivedAt: "2026-01-01 00:00:00",
  });
  await seedMessage(erste.id, {
    number: 5,
    variant: "a",
    audience: "ghost",
    topic: "top1",
    status: "ACTIVE",
  });
}

type Sheet = { name: string; data: (string | number | null)[][] };

function parse(buffer: Buffer): Sheet[] {
  return xlsx.parse(buffer) as Sheet[];
}

function sheet(sheets: Sheet[], name: string): Sheet {
  const s = sheets.find((x) => x.name === name);
  expect(s, `sheet ${name}`).toBeDefined();
  return s!;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  await seedMatrix();
});

afterEach(async () => {
  await h.cleanup();
});

describe("exportMatrixXlsx", () => {
  it("no filters: one tab per product + fixed sheets, MC cell aggregation", async () => {
    const sheets = parse(await exportMatrixXlsx(erste.id, { products: [], statuses: [] }));
    expect(sheets.map((s) => s.name)).toEqual(["P1", "P2", "Audiences", "Topics", "MCs"]);

    const p1 = sheet(sheets, "P1");
    expect(p1.data[0]).toEqual(["Topic", "Name", "aud1", "aud2"]);
    // top1 row: aud1 cell has MC1a + MC2a (sorted), aud2 has MC1a; archived
    // MC4a and dangling-audience MC5a never appear.
    const top1Row = p1.data.find((r) => r[0] === "top1")!;
    expect(top1Row[2]).toBe("MC1a, MC2a");
    expect(top1Row[3]).toBe("MC1a");

    const p2 = sheet(sheets, "P2");
    const top3Row = p2.data.find((r) => r[0] === "top3")!;
    expect(top3Row[2]).toBe("MC3a");
  });

  it("MCs sheet: sibling dedupe, Audiences column, per-audience fields dropped", async () => {
    const sheets = parse(await exportMatrixXlsx(erste.id, { products: [], statuses: [] }));
    const mcs = sheet(sheets, "MCs");
    const headers = mcs.data[0] as string[];

    expect(headers).toContain("Audiences");
    expect(headers).toContain("Topic_Key");
    expect(headers).toContain("Landing_URL");
    for (const banned of [
      "Audience_Key",
      "PMMID",
      "Final_Trafficked_URL",
      "UTM_Campaign",
      "UTM_Source",
      "UTM_Medium",
      "UTM_Content",
      "UTM_Term",
      "UTM_CD26",
    ]) {
      expect(headers, `header ${banned} should be excluded`).not.toContain(banned);
    }
    // Audiences column sits where Audience_Key used to be (index 2).
    expect(headers[2]).toBe("Audiences");

    // MC1a siblings collapse to one row with both audience keys in matrix order.
    const numberIdx = headers.indexOf("Number");
    const variantIdx = headers.indexOf("Variant");
    const audiencesIdx = headers.indexOf("Audiences");
    const rows = mcs.data.slice(1);
    const mc1Rows = rows.filter((r) => r[numberIdx] === 1 && r[variantIdx] === "a");
    expect(mc1Rows).toHaveLength(1);
    expect(mc1Rows[0]![audiencesIdx]).toBe("aud1, aud2");

    // Rows: MC1a, MC2a, MC3a — archived + dangling excluded.
    expect(rows.map((r) => `MC${r[numberIdx]}${r[variantIdx]}`)).toEqual([
      "MC1a",
      "MC2a",
      "MC3a",
    ]);
  });

  it("product filter scopes tabs, Audiences/Topics sheets and MCs", async () => {
    const sheets = parse(await exportMatrixXlsx(erste.id, { products: ["P1"], statuses: [] }));
    expect(sheets.map((s) => s.name)).toEqual(["P1", "Audiences", "Topics", "MCs"]);

    const auds = sheet(sheets, "Audiences");
    expect(auds.data.slice(1).map((r) => r[0])).toEqual(["aud1", "aud2"]);
    const tops = sheet(sheets, "Topics");
    expect(tops.data.slice(1).map((r) => r[0])).toEqual(["top1", "top2"]);

    const mcs = sheet(sheets, "MCs");
    const headers = mcs.data[0] as string[];
    const numberIdx = headers.indexOf("Number");
    expect(mcs.data.slice(1).map((r) => r[numberIdx])).toEqual([1, 2]); // no P2 MC3
  });

  it("status filter mirrors the grid; empty result still builds", async () => {
    const active = parse(
      await exportMatrixXlsx(erste.id, { products: [], statuses: ["ACTIVE"] }),
    );
    const mcs = sheet(active, "MCs");
    const headers = mcs.data[0] as string[];
    const numberIdx = headers.indexOf("Number");
    expect(mcs.data.slice(1).map((r) => r[numberIdx])).toEqual([1, 3]); // CONTENT MC2 dropped

    const dead = parse(
      await exportMatrixXlsx(erste.id, { products: [], statuses: ["DEAD"] }),
    );
    expect(sheet(dead, "MCs").data).toHaveLength(1); // header only
    expect(sheet(dead, "P1").data[0]).toEqual(["Topic", "Name", "aud1", "aud2"]);
  });
});
