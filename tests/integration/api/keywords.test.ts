import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  archiveKeyword,
  createKeyword,
  KeywordError,
  listKeywords,
  reorderKeywords,
  restoreKeyword,
  updateKeyword,
} from "@/lib/entities/keywords";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
});

afterEach(() => {
  h.cleanup();
});

describe("keywords CRUD", () => {
  it("creates and reads back, scoped per client", () => {
    const k = createKeyword(erste.id, {
      form: "audiences",
      field: "buyingPlatform",
      value: "adform",
    });
    expect(k.clientId).toBe(erste.id);
    expect(k.orderIndex).toBe(0);
    expect(listKeywords(telekom.id)).toHaveLength(0);
    expect(listKeywords(erste.id)).toHaveLength(1);
  });

  it("auto-increments orderIndex per (form, field) cohort", () => {
    const a = createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    const c = createKeyword(erste.id, { form: "audiences", field: "device", value: "mobile" });
    expect(a.orderIndex).toBe(0);
    expect(b.orderIndex).toBe(1);
    // Different (form, field) cohort restarts at 0.
    expect(c.orderIndex).toBe(0);
  });

  it("rejects duplicate value within a (form, field) cohort", () => {
    createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    expect(() =>
      createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" }),
    ).toThrow(KeywordError);
    // Same value in a different field is fine.
    expect(() =>
      createKeyword(erste.id, { form: "audiences", field: "device", value: "ACTIVE" }),
    ).not.toThrow();
  });

  it("requires non-empty form/field/value", () => {
    expect(() => createKeyword(erste.id, { form: "", field: "x", value: "y" })).toThrow(KeywordError);
    expect(() => createKeyword(erste.id, { form: "audiences", field: "", value: "y" })).toThrow(KeywordError);
    expect(() => createKeyword(erste.id, { form: "audiences", field: "x", value: "  " })).toThrow(KeywordError);
  });

  it("renames a value via updateKeyword", () => {
    const k = createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const updated = updateKeyword(erste.id, k.id, { value: "active" });
    expect(updated?.value).toBe("active");
    expect(updated?.id).toBe(k.id);
  });

  it("rejects update that would collide with another value", () => {
    createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    expect(() => updateKeyword(erste.id, b.id, { value: "ACTIVE" })).toThrow(KeywordError);
  });

  it("foreign client cannot update", () => {
    const k = createKeyword(telekom.id, { form: "audiences", field: "status", value: "X" });
    const r = updateKeyword(erste.id, k.id, { value: "hijack" });
    expect(r).toBeNull();
  });

  it("archive hides from default list, restore reinstates", () => {
    const k = createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    expect(listKeywords(erste.id)).toHaveLength(1);
    archiveKeyword(erste.id, k.id);
    expect(listKeywords(erste.id)).toHaveLength(0);
    expect(listKeywords(erste.id, { includeArchived: true })).toHaveLength(1);
    restoreKeyword(erste.id, k.id);
    expect(listKeywords(erste.id)).toHaveLength(1);
  });

  it("reorderKeywords sets orderIndex to ids position; tenant-scoped", () => {
    const a = createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    const c = createKeyword(erste.id, { form: "audiences", field: "status", value: "PLANNED" });
    reorderKeywords(erste.id, "audiences", "status", [c.id, a.id, b.id]);
    const rows = listKeywords(erste.id, { form: "audiences", field: "status" });
    expect(rows.map((r) => r.value)).toEqual(["PLANNED", "ACTIVE", "INACTIVE"]);
    // A foreign client's reorder is a no-op on Erste's rows.
    reorderKeywords(telekom.id, "audiences", "status", [a.id, b.id, c.id]);
    const after = listKeywords(erste.id, { form: "audiences", field: "status" });
    expect(after.map((r) => r.value)).toEqual(["PLANNED", "ACTIVE", "INACTIVE"]);
  });

  it("listKeywords filters by form + field", () => {
    createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    createKeyword(erste.id, { form: "audiences", field: "device", value: "mobile" });
    createKeyword(erste.id, { form: "topics", field: "tag1", value: "brand" });
    expect(listKeywords(erste.id, { form: "audiences" })).toHaveLength(2);
    expect(listKeywords(erste.id, { form: "audiences", field: "status" })).toHaveLength(1);
    expect(listKeywords(erste.id, { form: "topics" })).toHaveLength(1);
  });
});
