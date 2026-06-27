import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { audiences, clients } from "@/db/schema";
import {
  _resetSubscribersForTests,
  subscribe,
  type BroadcastEvent,
} from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  _resetSubscribersForTests();
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
  _resetSubscribersForTests();
});

describe("SSE broadcast (Spec §4.11)", () => {
  it("writeAudit broadcasts to active subscribers of the same client", async () => {
    const events: BroadcastEvent[] = [];
    subscribe(erste.id, (e) => events.push(e));

    await db
      .insert(audiences)
      .values({ clientId: erste.id, key: "aud1", name: "A", orderIndex: 0 });
    await writeAudit({
      clientId: erste.id,
      userId: "u1",
      entityType: "audiences",
      entityId: 1,
      action: "create",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      entity: "audiences",
      ids: [1],
      action: "create",
      byUser: "u1",
    });
  });

  it("broadcasts are scoped per client — Erste subscribers don't see Telekom events", async () => {
    const ersteEvents: BroadcastEvent[] = [];
    const telekomEvents: BroadcastEvent[] = [];
    subscribe(erste.id, (e) => ersteEvents.push(e));
    subscribe(telekom.id, (e) => telekomEvents.push(e));

    await writeAudit({
      clientId: telekom.id,
      userId: "tk-user",
      entityType: "messages",
      entityId: 42,
      action: "create",
    });

    expect(ersteEvents).toHaveLength(0);
    expect(telekomEvents).toHaveLength(1);
    expect(telekomEvents[0].entity).toBe("messages");
  });

  it("unsubscribe stops further events", async () => {
    const events: BroadcastEvent[] = [];
    const unsub = subscribe(erste.id, (e) => events.push(e));

    await writeAudit({
      clientId: erste.id,
      userId: "u",
      entityType: "topics",
      entityId: 1,
      action: "create",
    });
    expect(events).toHaveLength(1);

    unsub();
    await writeAudit({
      clientId: erste.id,
      userId: "u",
      entityType: "topics",
      entityId: 2,
      action: "create",
    });
    expect(events).toHaveLength(1);
  });

  it("a throwing subscriber does not break sibling subscribers", async () => {
    const seen: BroadcastEvent[] = [];
    subscribe(erste.id, () => {
      throw new Error("boom");
    });
    subscribe(erste.id, (e) => seen.push(e));

    await writeAudit({
      clientId: erste.id,
      userId: "u",
      entityType: "audiences",
      entityId: 1,
      action: "update",
    });
    expect(seen).toHaveLength(1);
  });
});
