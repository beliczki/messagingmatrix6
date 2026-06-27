import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { readEntityHistory, writeAudit } from "@/lib/audit";
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

describe("readEntityHistory", () => {
  it("returns the entity's audit rows newest-first with before/after snapshots", async () => {
    await writeAudit({
      clientId: erste.id,
      userId: "u1",
      entityType: "topics",
      entityId: 7,
      action: "create",
      after: { name: "A" },
    });
    await writeAudit({
      clientId: erste.id,
      userId: "u1",
      entityType: "topics",
      entityId: 7,
      action: "update",
      before: { name: "A" },
      after: { name: "B" },
    });

    const rows = await readEntityHistory(erste.id, "topics", 7);
    expect(rows).toHaveLength(2);
    // Newest first — the update precedes the create.
    expect(rows[0].action).toBe("update");
    expect(rows[1].action).toBe("create");
    expect(JSON.parse(rows[0].after!)).toEqual({ name: "B" });
    expect(JSON.parse(rows[0].before!)).toEqual({ name: "A" });
  });

  it("filters by entity type and id", async () => {
    await writeAudit({ clientId: erste.id, userId: null, entityType: "topics", entityId: 1, action: "create" });
    await writeAudit({ clientId: erste.id, userId: null, entityType: "audiences", entityId: 1, action: "create" });
    await writeAudit({ clientId: erste.id, userId: null, entityType: "topics", entityId: 2, action: "create" });

    expect(await readEntityHistory(erste.id, "topics", 1)).toHaveLength(1);
    expect(await readEntityHistory(erste.id, "audiences", 1)).toHaveLength(1);
    expect(await readEntityHistory(erste.id, "topics", 2)).toHaveLength(1);
  });

  it("tenant isolation — never returns another client's history", async () => {
    await writeAudit({
      clientId: telekom.id,
      userId: null,
      entityType: "topics",
      entityId: 5,
      action: "create",
    });
    expect(await readEntityHistory(erste.id, "topics", 5)).toHaveLength(0);
  });
});
