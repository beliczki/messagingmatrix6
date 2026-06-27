import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, messages } from "@/db/schema";
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

describe("snapshots — create + restore round trip", () => {
  it("captures the live state and restores it after wipe", async () => {
    // Seed a tiny dataset.
    const aud = await createAudience(erste.id, { name: "Mass Market" });
    const top = await createTopic(erste.id, { name: "Card", product: "Card" });
    const m = await createMessage(erste.id, {
      audience: aud.key,
      topic: top.key,
      headline: "Original headline",
    });
    expect(m.headline).toBe("Original headline");

    // Snapshot.
    const snap = await createSnapshot(erste.id, "before-edit", "u-test");
    expect(snap.label).toBe("before-edit");
    expect(snap.counts.audiences).toBe(1);
    expect(snap.counts.topics).toBe(1);
    expect(snap.counts.messages).toBe(1);

    // Mutate: change message headline + delete the audience.
    await db
      .update(messages)
      .set({ headline: "Updated headline" })
      .where(eq(messages.id, m.id));
    await db.delete(audiences).where(eq(audiences.id, aud.id));

    expect(
      await db.select().from(audiences).where(eq(audiences.clientId, erste.id)),
    ).toHaveLength(0);
    expect(
      (await db.select().from(messages).where(eq(messages.id, m.id)))[0]
        ?.headline,
    ).toBe("Updated headline");

    // Restore.
    const r = await restoreSnapshot(erste.id, snap.id);
    expect(r.ok).toBe(true);
    expect(
      await db.select().from(audiences).where(eq(audiences.clientId, erste.id)),
    ).toHaveLength(1);
    expect(
      (await db.select().from(messages).where(eq(messages.id, m.id)))[0]
        ?.headline,
    ).toBe("Original headline");
  });

  it("scopes to the active client — restoring Erste does not touch Telekom", async () => {
    await createAudience(erste.id, { name: "Erste Aud" });
    await createAudience(telekom.id, { name: "Telekom Aud" });

    const snap = await createSnapshot(erste.id, "erste-only", null);

    // Add another audience to both clients after the snapshot.
    await createAudience(erste.id, { name: "Erste Extra" });
    const tExtra = await createAudience(telekom.id, { name: "Telekom Extra" });

    const r = await restoreSnapshot(erste.id, snap.id);
    expect(r.ok).toBe(true);

    // Erste rolled back to 1.
    expect(
      await db.select().from(audiences).where(eq(audiences.clientId, erste.id)),
    ).toHaveLength(1);
    // Telekom untouched: still has both rows.
    expect(
      await db.select().from(audiences).where(eq(audiences.clientId, telekom.id)),
    ).toHaveLength(2);
    // The Telekom-extra row id we inserted is still present.
    expect(
      (await db.select().from(audiences).where(eq(audiences.id, tExtra.id)))[0],
    ).not.toBeUndefined();
  });

  it("listSnapshots returns newest first; deleteSnapshot removes one", async () => {
    const a = await createSnapshot(erste.id, "first", null);
    const b = await createSnapshot(erste.id, "second", null);
    const list = await listSnapshots(erste.id);
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);

    expect(await deleteSnapshot(erste.id, a.id)).toBe(true);
    expect((await listSnapshots(erste.id)).map((s) => s.id)).toEqual([b.id]);
    // Cross-client delete attempt: telekom can't delete erste's snapshot.
    expect(await deleteSnapshot(telekom.id, b.id)).toBe(false);
  });
});
