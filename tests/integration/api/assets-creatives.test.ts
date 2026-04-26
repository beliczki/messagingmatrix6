import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from "@/lib/entities/assets";
import {
  createCreative,
  getCreative,
  listCreatives,
  updateCreative,
} from "@/lib/entities/creatives";
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

describe("assets — client isolation + optimistic lock", () => {
  it("Telekom asset is invisible to Erste", () => {
    const e = createAsset(erste.id, { brand: "Erste", product: "X" });
    const t = createAsset(telekom.id, { brand: "Telekom", product: "X" });
    expect(listAssets(erste.id).map((r) => r.id)).toEqual([e.id]);
    expect(getAsset(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found", () => {
    const t = createAsset(telekom.id, { brand: "T", product: "X" });
    const r = updateAsset(erste.id, t.id, t.version, { brand: "hijack" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect(getAsset(telekom.id, t.id)?.brand).toBe("T");
  });

  it("optimistic lock — stale version rejects", () => {
    const a = createAsset(erste.id, { brand: "Initial" });
    const ok = updateAsset(erste.id, a.id, 1, { brand: "Updated" });
    expect(ok.ok).toBe(true);
    const stale = updateAsset(erste.id, a.id, 1, { brand: "Stale" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });

  it("hard delete with version", () => {
    const a = createAsset(erste.id, { brand: "X" });
    const r = deleteAsset(erste.id, a.id, 1);
    expect(r.ok).toBe(true);
    expect(getAsset(erste.id, a.id)).toBeNull();
  });
});

describe("creatives — client isolation + optimistic lock", () => {
  it("Telekom creative is invisible to Erste", () => {
    const e = createCreative(erste.id, { brand: "E", template: "card" });
    const t = createCreative(telekom.id, { brand: "T", template: "card" });
    expect(listCreatives(erste.id).map((r) => r.id)).toEqual([e.id]);
    expect(getCreative(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found", () => {
    const t = createCreative(telekom.id, { brand: "T" });
    const r = updateCreative(erste.id, t.id, t.version, { brand: "hijack" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect(getCreative(telekom.id, t.id)?.brand).toBe("T");
  });
});
