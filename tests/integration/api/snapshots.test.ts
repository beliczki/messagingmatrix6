import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages, topics } from "@/db/schema";
import { createAudience } from "@/lib/entities/audiences";
import { createTopic } from "@/lib/entities/topics";
import { createMessage } from "@/lib/entities/messages";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
} from "@/lib/snapshots";
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

describe("snapshots — create + restore round trip", () => {
  it("captures the live state and restores it after wipe", () => {
    // Seed a tiny dataset.
    const aud = createAudience(erste.id, { name: "Mass Market" });
    const top = createTopic(erste.id, { name: "Card", product: "Card" });
    const m = createMessage(erste.id, {
      audience: aud.key,
      topic: top.key,
      headline: "Original headline",
    });
    expect(m.headline).toBe("Original headline");

    // Snapshot.
    const snap = createSnapshot(erste.id, "before-edit", "u-test");
    expect(snap.label).toBe("before-edit");
    expect(snap.counts.audiences).toBe(1);
    expect(snap.counts.topics).toBe(1);
    expect(snap.counts.messages).toBe(1);

    // Mutate: change message headline + delete the audience.
    db.update(messages)
      .set({ headline: "Updated headline" })
      .where(eq(messages.id, m.id))
      .run();
    db.delete(audiences).where(eq(audiences.id, aud.id)).run();

    expect(
      db.select().from(audiences).where(eq(audiences.clientId, erste.id)).all(),
    ).toHaveLength(0);
    expect(
      db.select().from(messages).where(eq(messages.id, m.id)).get()?.headline,
    ).toBe("Updated headline");

    // Restore.
    const r = restoreSnapshot(erste.id, snap.id);
    expect(r.ok).toBe(true);
    expect(
      db.select().from(audiences).where(eq(audiences.clientId, erste.id)).all(),
    ).toHaveLength(1);
    expect(
      db.select().from(messages).where(eq(messages.id, m.id)).get()?.headline,
    ).toBe("Original headline");
  });

  it("scopes to the active client — restoring Erste does not touch Telekom", () => {
    createAudience(erste.id, { name: "Erste Aud" });
    createAudience(telekom.id, { name: "Telekom Aud" });

    const snap = createSnapshot(erste.id, "erste-only", null);

    // Add another audience to both clients after the snapshot.
    createAudience(erste.id, { name: "Erste Extra" });
    const tExtra = createAudience(telekom.id, { name: "Telekom Extra" });

    const r = restoreSnapshot(erste.id, snap.id);
    expect(r.ok).toBe(true);

    // Erste rolled back to 1.
    expect(
      db.select().from(audiences).where(eq(audiences.clientId, erste.id)).all(),
    ).toHaveLength(1);
    // Telekom untouched: still has both rows.
    expect(
      db.select().from(audiences).where(eq(audiences.clientId, telekom.id)).all(),
    ).toHaveLength(2);
    // The Telekom-extra row id we inserted is still present.
    expect(
      db.select().from(audiences).where(eq(audiences.id, tExtra.id)).get(),
    ).not.toBeUndefined();
  });

  it("listSnapshots returns newest first; deleteSnapshot removes one", () => {
    const a = createSnapshot(erste.id, "first", null);
    const b = createSnapshot(erste.id, "second", null);
    const list = listSnapshots(erste.id);
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);

    expect(deleteSnapshot(erste.id, a.id)).toBe(true);
    expect(listSnapshots(erste.id).map((s) => s.id)).toEqual([b.id]);
    // Cross-client delete attempt: telekom can't delete erste's snapshot.
    expect(deleteSnapshot(telekom.id, b.id)).toBe(false);
  });
});
