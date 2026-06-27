import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  archiveAsset,
  createAsset,
  getAsset,
  listAssets,
  restoreAsset,
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

describe("assets — client isolation + optimistic lock", () => {
  it("Telekom asset is invisible to Erste", async () => {
    const e = await createAsset(erste.id, { brand: "Erste", product: "X" });
    const t = await createAsset(telekom.id, { brand: "Telekom", product: "X" });
    expect((await listAssets(erste.id)).map((r) => r.id)).toEqual([e.id]);
    expect(await getAsset(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found", async () => {
    const t = await createAsset(telekom.id, { brand: "T", product: "X" });
    const r = await updateAsset(erste.id, t.id, t.version, { brand: "hijack" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect((await getAsset(telekom.id, t.id))?.brand).toBe("T");
  });

  it("optimistic lock — stale version rejects", async () => {
    const a = await createAsset(erste.id, { brand: "Initial" });
    const ok = await updateAsset(erste.id, a.id, 1, { brand: "Updated" });
    expect(ok.ok).toBe(true);
    const stale = await updateAsset(erste.id, a.id, 1, { brand: "Stale" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });

  it("archive sets archived_at; restore brings the row back; default list filters", async () => {
    const a = await createAsset(erste.id, { brand: "X" });
    const r = await archiveAsset(erste.id, a.id, 1);
    expect(r.ok).toBe(true);
    const archived = await getAsset(erste.id, a.id);
    expect(archived?.archivedAt).not.toBeNull();
    expect((await listAssets(erste.id)).map((x) => x.id)).not.toContain(a.id);
    expect(
      (await listAssets(erste.id, { includeArchived: true })).map((x) => x.id),
    ).toContain(a.id);
    const back = await restoreAsset(erste.id, a.id, archived!.version);
    expect(back.ok).toBe(true);
    expect((await getAsset(erste.id, a.id))?.archivedAt).toBeNull();
  });
});

describe("creatives — client isolation + optimistic lock", () => {
  it("Telekom creative is invisible to Erste", async () => {
    const e = await createCreative(erste.id, { brand: "E", template: "card" });
    const t = await createCreative(telekom.id, { brand: "T", template: "card" });
    expect((await listCreatives(erste.id)).map((r) => r.id)).toEqual([e.id]);
    expect(await getCreative(erste.id, t.id)).toBeNull();
  });

  it("update with foreign client_id returns not-found", async () => {
    const t = await createCreative(telekom.id, { brand: "T" });
    const r = await updateCreative(erste.id, t.id, t.version, {
      brand: "hijack",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.current).toBeNull();
    expect((await getCreative(telekom.id, t.id))?.brand).toBe("T");
  });
});
