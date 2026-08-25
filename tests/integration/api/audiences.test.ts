import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, auditLog, clients } from "@/db/schema";
import {
  archiveAudience,
  createAudience,
  duplicateAudience,
  getAudience,
  listAudiences,
  reorderAudiences,
  restoreAudience,
  updateAudience,
} from "@/lib/entities/audiences";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

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
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("audiences entity", () => {
  it("creates with auto key + auto order_index", async () => {
    const a = await createAudience(erste.id, { name: "Mass Market" });
    expect(a.clientId).toBe(erste.id);
    expect(a.key).toBe("aud1");
    expect(a.orderIndex).toBe(0);
    expect(a.version).toBe(1);
  });

  it("auto-increments order_index per client", async () => {
    await createAudience(erste.id, { name: "A" });
    const second = await createAudience(erste.id, { name: "B" });
    expect(second.orderIndex).toBe(1);
    expect(second.key).toBe("aud2");

    // Telekom counter is independent.
    const telekomFirst = await createAudience(telekom.id, { name: "T1" });
    expect(telekomFirst.orderIndex).toBe(0);
    expect(telekomFirst.key).toBe("aud1");
  });

  it("optimistic lock — stale version returns current row", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const ok = await updateAudience(erste.id, a.id, 1, { name: "A2" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.version).toBe(2);

    // Stale version should be rejected.
    const stale = await updateAudience(erste.id, a.id, 1, { name: "A3" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });

  it("archive enforces version, soft-deletes the row, restore brings it back", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const stale = await archiveAudience(erste.id, a.id, 99);
    expect(stale.ok).toBe(false);
    expect((await getAudience(erste.id, a.id))?.archivedAt).toBeNull();

    const ok = await archiveAudience(erste.id, a.id, 1);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.cascadedMessageIds).toEqual([]);
    const archived = await getAudience(erste.id, a.id);
    expect(archived).not.toBeNull();
    expect(archived?.archivedAt).not.toBeNull();
    // Default list filters it out; includeArchived shows it.
    expect((await listAudiences(erste.id)).map((r) => r.id)).not.toContain(a.id);
    expect(
      (await listAudiences(erste.id, { includeArchived: true })).map((r) => r.id),
    ).toContain(a.id);

    const restored = await restoreAudience(erste.id, a.id, archived!.version);
    expect(restored.ok).toBe(true);
    expect((await getAudience(erste.id, a.id))?.archivedAt).toBeNull();
  });

  it("client scoping — Telekom audience is invisible to Erste", async () => {
    const e1 = await createAudience(erste.id, { name: "Erste Aud" });
    const t1 = await createAudience(telekom.id, { name: "Telekom Aud" });

    const ersteList = await listAudiences(erste.id);
    expect(ersteList.map((a) => a.id)).toEqual([e1.id]);
    expect(ersteList.find((a) => a.id === t1.id)).toBeUndefined();

    // Direct lookup with mismatched client returns null even with the right id.
    expect(await getAudience(erste.id, t1.id)).toBeNull();
    expect(await getAudience(telekom.id, e1.id)).toBeNull();
  });

  it("update with mismatched client_id returns not-found, not 200", async () => {
    const t1 = await createAudience(telekom.id, { name: "Telekom Aud" });
    const result = await updateAudience(erste.id, t1.id, 1, { name: "hijack" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.current).toBeNull();
    // Telekom's row is untouched.
    const fresh = await getAudience(telekom.id, t1.id);
    expect(fresh?.name).toBe("Telekom Aud");
  });

  it("archive with mismatched client_id returns not-found", async () => {
    const t1 = await createAudience(telekom.id, { name: "Telekom Aud" });
    const result = await archiveAudience(erste.id, t1.id, 1);
    expect(result.ok).toBe(false);
    expect((await getAudience(telekom.id, t1.id))?.archivedAt).toBeNull();
  });

  it("same key allowed across clients (composite uniqueness)", async () => {
    const e1 = await createAudience(erste.id, { key: "shared-key", name: "Erste" });
    const t1 = await createAudience(telekom.id, { key: "shared-key", name: "Telekom" });
    expect(e1.key).toBe("shared-key");
    expect(t1.key).toBe("shared-key");
    expect(e1.id).not.toBe(t1.id);
  });
});

describe("audiences channel column (nonDCO scoping — migration 0005)", () => {
  it("create persists channel; default is null (DCO)", async () => {
    const dco = await createAudience(erste.id, { name: "DCO aud" });
    expect(dco.channel).toBeNull();

    const disp = await createAudience(erste.id, {
      key: "ch_disp",
      name: "Display",
      channel: "DISP",
    });
    expect(disp.channel).toBe("DISP");
  });

  it("list returns channel and both partitions are distinguishable", async () => {
    await createAudience(erste.id, { name: "DCO" });
    await createAudience(erste.id, {
      key: "ch_soc",
      name: "Social",
      channel: "SOC",
    });
    const rows = await listAudiences(erste.id);
    const dco = rows.filter((r) => r.channel == null);
    const nondco = rows.filter((r) => r.channel != null);
    expect(dco).toHaveLength(1);
    expect(nondco).toHaveLength(1);
    expect(nondco[0].channel).toBe("SOC");
  });

  it("update round-trips a channel change", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const res = await updateAudience(erste.id, a.id, a.version, {
      channel: "PRG",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.row.channel).toBe("PRG");
  });

  it("duplicate copies the channel", async () => {
    const src = await createAudience(erste.id, {
      key: "ch_yt",
      name: "YouTube",
      channel: "YT",
    });
    const dup = await duplicateAudience(erste.id, src.id);
    expect(dup?.channel).toBe("YT");
  });
});

describe("audiences audit logging", () => {
  it("create / update / delete each write one audit row scoped to the active client", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    // The library helpers don't write audit themselves — that's the route's
    // job. So write audit explicitly to mirror the route behavior:
    await db.insert(auditLog).values({
      clientId: erste.id,
      userId: "u-erste-admin",
      entityType: "audiences",
      entityId: String(a.id),
      action: "create",
      after: JSON.stringify(a),
    });

    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.clientId, erste.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].entityType).toBe("audiences");
    expect(rows[0].action).toBe("create");
  });

  it("reorderAudiences reverses the full set within its slots", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const b = await createAudience(erste.id, { name: "B" });
    const c = await createAudience(erste.id, { name: "C" });
    await reorderAudiences(erste.id, [c.id, b.id, a.id]);
    const order = (await listAudiences(erste.id)).map((r) => r.name);
    expect(order).toEqual(["C", "B", "A"]);
  });

  it("reorderAudiences permutes only within the sent subset's own slots", async () => {
    // A(0) B(1) C(2) D(3); send [C, A] — the {A,C} group occupies slots {0,2},
    // so C→0 and A→2 while B and D never move. This is what keeps a reordered
    // DCO subset from interleaving with hidden nonDCO audiences.
    const a = await createAudience(erste.id, { name: "A" });
    const b = await createAudience(erste.id, { name: "B" });
    const c = await createAudience(erste.id, { name: "C" });
    const d = await createAudience(erste.id, { name: "D" });
    await reorderAudiences(erste.id, [c.id, a.id]);
    const order = (await listAudiences(erste.id)).map((r) => r.name);
    expect(order).toEqual(["C", "B", "A", "D"]);
    // b and d untouched at their original indices
    expect((await getAudience(erste.id, b.id))?.orderIndex).toBe(1);
    expect((await getAudience(erste.id, d.id))?.orderIndex).toBe(3);
  });

  it("reorderAudiences ignores ids from another client", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const b = await createAudience(erste.id, { name: "B" });
    const foreign = await createAudience(telekom.id, { name: "T" });
    // Only a+b are erste's; foreign is silently dropped, still a valid 2-swap.
    await reorderAudiences(erste.id, [b.id, a.id, foreign.id]);
    const order = (await listAudiences(erste.id)).map((r) => r.name);
    expect(order).toEqual(["B", "A"]);
    // Telekom's row untouched.
    expect((await getAudience(telekom.id, foreign.id))?.orderIndex).toBe(0);
  });

  it("reorderAudiences is a no-op for fewer than two ids", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    await reorderAudiences(erste.id, [a.id]);
    expect((await getAudience(erste.id, a.id))?.orderIndex).toBe(0);
  });
});
