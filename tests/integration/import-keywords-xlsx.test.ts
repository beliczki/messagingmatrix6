import { describe, it, expect, beforeEach, afterEach } from "vitest";
import xlsx from "node-xlsx";
import { db } from "@/db";
import { clients, keywords } from "@/db/schema";
import { eq } from "drizzle-orm";
import { importErsteXlsx } from "@/lib/import-xlsx";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
});

afterEach(() => {
  h.cleanup();
});

function buildXlsx(): Buffer {
  // Subset of the real Erste keywords sheet — same shape, fewer rows.
  // Mixes in-scope (audiences + topics) and out-of-scope (messages, tasks,
  // assets) rows so the importer's filter logic is exercised.
  const data = [
    ["form", "field", "values"],
    ["audiences", "Status", "ACTIVE, INACTIVE, PLANNED"],
    ["audiences", "Buying_platform", "adform, dv360, meta"],
    ["audiences", "Device", "mobile,desktop, all"],
    ["topics", "Tag1", "brand, promocio, elethelyzet"],
    ["topics", "Status", "ACTIVE, INACTIVE"],
    ["messages", "Status", "INCOMING, NAMING"],
    ["tasks", "Bucket", "INCOMING, DEAD"],
    ["assets", "Type", "logo, background"],
    // Out-of-scope field on an in-scope form: also dropped.
    ["audiences", "UnknownField", "x, y"],
    // Empty values cell — declared but nothing to seed.
    ["audiences", "Strategy", ""],
    // Duplicate value in a list — second occurrence skipped.
    ["audiences", "Status", "ACTIVE"],
  ];
  return xlsx.build([{ name: "keywords", data, options: {} }]) as Buffer;
}

describe("XLSX importer: keywords sheet", () => {
  it("seeds in-scope (form, field) values from a comma list, in order", () => {
    const buf = buildXlsx();
    const result = importErsteXlsx(buf, { clientId: erste.id, wipeFirst: false });

    // Inserted = 3 status + 3 platform + 3 device + 3 tag1 + 2 topic status
    //         = 14 keyword rows
    expect(result.inserted.keywords).toBe(14);

    // Out-of-scope rows are silently skipped:
    // messages/Status, tasks/Bucket, assets/Type, audiences/UnknownField,
    // plus the duplicate audiences/Status row = 5 skipped.
    // (audiences/Strategy with empty values isn't a skip — it's "no values to insert".)
    expect(result.skipped.keywords).toBe(5);
    // Other sheets are missing from the test fixture → importer logs warnings.
    // Filter to keyword-related errors (there should be none).
    const kwErrors = result.errors.filter((e) => /^keywords\[/.test(e));
    expect(kwErrors).toEqual([]);

    const all = db
      .select()
      .from(keywords)
      .where(eq(keywords.clientId, erste.id))
      .all();

    // Status values keep XLSX order.
    const statuses = all
      .filter((k) => k.form === "audiences" && k.field === "status")
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((k) => k.value);
    expect(statuses).toEqual(["ACTIVE", "INACTIVE", "PLANNED"]);

    // snake_case → camelCase field name on import.
    const platforms = all.filter(
      (k) => k.form === "audiences" && k.field === "buyingPlatform",
    );
    expect(platforms.map((p) => p.value).sort()).toEqual(["adform", "dv360", "meta"]);

    // Device: extra whitespace inside the comma list is trimmed.
    const devices = all
      .filter((k) => k.form === "audiences" && k.field === "device")
      .map((k) => k.value);
    expect(devices.sort()).toEqual(["all", "desktop", "mobile"]);

    // No messages/tasks/assets rows landed.
    expect(all.find((k) => k.form === "messages")).toBeUndefined();
    expect(all.find((k) => k.form === "tasks")).toBeUndefined();
    expect(all.find((k) => k.form === "assets")).toBeUndefined();
  });

  it("dryRun=true makes no permanent rows", () => {
    const buf = buildXlsx();
    const result = importErsteXlsx(buf, {
      clientId: erste.id,
      wipeFirst: false,
      dryRun: true,
    });
    expect(result.inserted.keywords).toBe(14);
    const all = db
      .select()
      .from(keywords)
      .where(eq(keywords.clientId, erste.id))
      .all();
    expect(all).toHaveLength(0);
  });

  it("wipe=true clears previous keywords for the same client", () => {
    const buf = buildXlsx();
    importErsteXlsx(buf, { clientId: erste.id, wipeFirst: false });
    const before = db
      .select()
      .from(keywords)
      .where(eq(keywords.clientId, erste.id))
      .all();
    expect(before.length).toBeGreaterThan(0);

    importErsteXlsx(buf, { clientId: erste.id, wipeFirst: true });
    const after = db
      .select()
      .from(keywords)
      .where(eq(keywords.clientId, erste.id))
      .all();
    // Same XLSX → same total. No accumulation, no UNIQUE violations.
    expect(after.length).toBe(before.length);
  });
});
