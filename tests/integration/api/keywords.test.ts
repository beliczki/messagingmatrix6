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

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("keywords CRUD", () => {
  it("creates and reads back, scoped per client", async () => {
    const k = await createKeyword(erste.id, {
      form: "audiences",
      field: "buyingPlatform",
      value: "adform",
    });
    expect(k.clientId).toBe(erste.id);
    expect(k.orderIndex).toBe(0);
    expect(await listKeywords(telekom.id)).toHaveLength(0);
    expect(await listKeywords(erste.id)).toHaveLength(1);
  });

  it("auto-increments orderIndex per (form, field) cohort", async () => {
    const a = await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = await createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    const c = await createKeyword(erste.id, { form: "audiences", field: "device", value: "mobile" });
    expect(a.orderIndex).toBe(0);
    expect(b.orderIndex).toBe(1);
    // Different (form, field) cohort restarts at 0.
    expect(c.orderIndex).toBe(0);
  });

  it("rejects duplicate value within a (form, field) cohort", async () => {
    await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    await expect(
      createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" }),
    ).rejects.toThrow(KeywordError);
    // Same value in a different field is fine.
    await expect(
      createKeyword(erste.id, { form: "audiences", field: "device", value: "ACTIVE" }),
    ).resolves.toBeDefined();
  });

  it("requires non-empty form/field/value", async () => {
    await expect(createKeyword(erste.id, { form: "", field: "x", value: "y" })).rejects.toThrow(KeywordError);
    await expect(createKeyword(erste.id, { form: "audiences", field: "", value: "y" })).rejects.toThrow(KeywordError);
    await expect(createKeyword(erste.id, { form: "audiences", field: "x", value: "  " })).rejects.toThrow(KeywordError);
  });

  it("renames a value via updateKeyword", async () => {
    const k = await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const updated = await updateKeyword(erste.id, k.id, { value: "active" });
    expect(updated?.value).toBe("active");
    expect(updated?.id).toBe(k.id);
  });

  it("rejects update that would collide with another value", async () => {
    await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = await createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    await expect(updateKeyword(erste.id, b.id, { value: "ACTIVE" })).rejects.toThrow(KeywordError);
  });

  it("foreign client cannot update", async () => {
    const k = await createKeyword(telekom.id, { form: "audiences", field: "status", value: "X" });
    const r = await updateKeyword(erste.id, k.id, { value: "hijack" });
    expect(r).toBeNull();
  });

  it("archive hides from default list, restore reinstates", async () => {
    const k = await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    expect(await listKeywords(erste.id)).toHaveLength(1);
    await archiveKeyword(erste.id, k.id);
    expect(await listKeywords(erste.id)).toHaveLength(0);
    expect(await listKeywords(erste.id, { includeArchived: true })).toHaveLength(1);
    await restoreKeyword(erste.id, k.id);
    expect(await listKeywords(erste.id)).toHaveLength(1);
  });

  it("reorderKeywords sets orderIndex to ids position; tenant-scoped", async () => {
    const a = await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    const b = await createKeyword(erste.id, { form: "audiences", field: "status", value: "INACTIVE" });
    const c = await createKeyword(erste.id, { form: "audiences", field: "status", value: "PLANNED" });
    await reorderKeywords(erste.id, "audiences", "status", [c.id, a.id, b.id]);
    const rows = await listKeywords(erste.id, { form: "audiences", field: "status" });
    expect(rows.map((r) => r.value)).toEqual(["PLANNED", "ACTIVE", "INACTIVE"]);
    // A foreign client's reorder is a no-op on Erste's rows.
    await reorderKeywords(telekom.id, "audiences", "status", [a.id, b.id, c.id]);
    const after = await listKeywords(erste.id, { form: "audiences", field: "status" });
    expect(after.map((r) => r.value)).toEqual(["PLANNED", "ACTIVE", "INACTIVE"]);
  });

  it("listKeywords filters by form + field", async () => {
    await createKeyword(erste.id, { form: "audiences", field: "status", value: "ACTIVE" });
    await createKeyword(erste.id, { form: "audiences", field: "device", value: "mobile" });
    await createKeyword(erste.id, { form: "topics", field: "tag1", value: "brand" });
    expect(await listKeywords(erste.id, { form: "audiences" })).toHaveLength(2);
    expect(await listKeywords(erste.id, { form: "audiences", field: "status" })).toHaveLength(1);
    expect(await listKeywords(erste.id, { form: "topics" })).toHaveLength(1);
  });
});
