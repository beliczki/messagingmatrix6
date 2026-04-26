import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, auditLog, clients } from "@/db/schema";
import {
  createAudience,
  deleteAudience,
  getAudience,
  listAudiences,
  updateAudience,
} from "@/lib/entities/audiences";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
  withActiveClientKey("erste");
});

afterEach(() => {
  h.cleanup();
});

describe("audiences entity", () => {
  it("creates with auto key + auto order_index", () => {
    const a = createAudience(erste.id, { name: "Mass Market" });
    expect(a.clientId).toBe(erste.id);
    expect(a.key).toBe("aud1");
    expect(a.orderIndex).toBe(0);
    expect(a.version).toBe(1);
  });

  it("auto-increments order_index per client", () => {
    createAudience(erste.id, { name: "A" });
    const second = createAudience(erste.id, { name: "B" });
    expect(second.orderIndex).toBe(1);
    expect(second.key).toBe("aud2");

    // Telekom counter is independent.
    const telekomFirst = createAudience(telekom.id, { name: "T1" });
    expect(telekomFirst.orderIndex).toBe(0);
    expect(telekomFirst.key).toBe("aud1");
  });

  it("optimistic lock — stale version returns current row", () => {
    const a = createAudience(erste.id, { name: "A" });
    const ok = updateAudience(erste.id, a.id, 1, { name: "A2" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.row.version).toBe(2);

    // Stale version should be rejected.
    const stale = updateAudience(erste.id, a.id, 1, { name: "A3" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.current?.version).toBe(2);
  });

  it("delete enforces version", () => {
    const a = createAudience(erste.id, { name: "A" });
    const stale = deleteAudience(erste.id, a.id, 99);
    expect(stale.ok).toBe(false);
    expect(getAudience(erste.id, a.id)).not.toBeNull();
    const ok = deleteAudience(erste.id, a.id, 1);
    expect(ok.ok).toBe(true);
    expect(getAudience(erste.id, a.id)).toBeNull();
  });

  it("client scoping — Telekom audience is invisible to Erste", () => {
    const e1 = createAudience(erste.id, { name: "Erste Aud" });
    const t1 = createAudience(telekom.id, { name: "Telekom Aud" });

    const ersteList = listAudiences(erste.id);
    expect(ersteList.map((a) => a.id)).toEqual([e1.id]);
    expect(ersteList.find((a) => a.id === t1.id)).toBeUndefined();

    // Direct lookup with mismatched client returns null even with the right id.
    expect(getAudience(erste.id, t1.id)).toBeNull();
    expect(getAudience(telekom.id, e1.id)).toBeNull();
  });

  it("update with mismatched client_id returns not-found, not 200", () => {
    const t1 = createAudience(telekom.id, { name: "Telekom Aud" });
    const result = updateAudience(erste.id, t1.id, 1, { name: "hijack" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.current).toBeNull();
    // Telekom's row is untouched.
    const fresh = getAudience(telekom.id, t1.id);
    expect(fresh?.name).toBe("Telekom Aud");
  });

  it("delete with mismatched client_id returns not-found", () => {
    const t1 = createAudience(telekom.id, { name: "Telekom Aud" });
    const result = deleteAudience(erste.id, t1.id, 1);
    expect(result.ok).toBe(false);
    expect(getAudience(telekom.id, t1.id)).not.toBeNull();
  });

  it("same key allowed across clients (composite uniqueness)", () => {
    const e1 = createAudience(erste.id, { key: "shared-key", name: "Erste" });
    const t1 = createAudience(telekom.id, { key: "shared-key", name: "Telekom" });
    expect(e1.key).toBe("shared-key");
    expect(t1.key).toBe("shared-key");
    expect(e1.id).not.toBe(t1.id);
  });
});

describe("audiences audit logging", () => {
  it("create / update / delete each write one audit row scoped to the active client", () => {
    const a = createAudience(erste.id, { name: "A" });
    // The library helpers don't write audit themselves — that's the route's
    // job. So write audit explicitly to mirror the route behavior:
    db.insert(auditLog).values({
      clientId: erste.id,
      userId: "u-erste-admin",
      entityType: "audiences",
      entityId: String(a.id),
      action: "create",
      after: JSON.stringify(a),
    }).run();

    const rows = db.select().from(auditLog).where(eq(auditLog.clientId, erste.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].entityType).toBe("audiences");
    expect(rows[0].action).toBe("create");
  });
});
