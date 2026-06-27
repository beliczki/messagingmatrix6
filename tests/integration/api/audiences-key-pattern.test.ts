import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, config, messages, topics } from "@/db/schema";
import {
  createAudience,
  generateAudienceKey,
  listAudiences,
  updateAudience,
} from "@/lib/entities/audiences";
import { archiveMessage, createMessage } from "@/lib/entities/messages";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

async function writeAudiencePattern(clientId: number, pattern: string | null) {
  const value = JSON.stringify(pattern === null ? {} : { audienceKey: pattern });
  await db
    .insert(config)
    .values({ clientId, key: "patterns", category: "patterns", value })
    .onConflictDoUpdate({
      target: [config.clientId, config.key],
      set: { value },
    });
}

describe("generateAudienceKey", () => {
  it("falls back to aud{N+1} when no pattern is configured", async () => {
    expect(
      await generateAudienceKey(
        erste.id,
        {
          product: "SZA",
          strategy: "Prospecting",
          buyingPlatform: null,
          device: "Mobile",
          tag: null,
        },
        2,
      ),
    ).toBe("aud3");
  });

  it("uses the configured pattern with join()", async () => {
    await writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
    expect(
      await generateAudienceKey(
        erste.id,
        {
          product: "SZA",
          strategy: "Prospecting",
          buyingPlatform: null,
          device: "Mobile",
          tag: null,
        },
        0,
      ),
    ).toBe("sza_prospecting_mobile");
  });

  it("join() drops empty + 'NA' values cleanly", async () => {
    await writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}}, {{tag|lower}})",
    );
    expect(
      await generateAudienceKey(
        erste.id,
        {
          product: "SZA",
          strategy: "",
          buyingPlatform: null,
          device: "NA",
          tag: "promo",
        },
        0,
      ),
    ).toBe("sza_promo");
  });

  it("empty pattern output falls back to aud{N+1}", async () => {
    await writeAudiencePattern(erste.id, "join({{strategy}}, {{device}})");
    expect(
      await generateAudienceKey(
        erste.id,
        {
          product: null,
          strategy: "",
          buyingPlatform: null,
          device: "",
          tag: null,
        },
        5,
      ),
    ).toBe("aud6");
  });
});

describe("createAudience uses the configured key pattern", () => {
  it("create with no explicit key + no pattern → aud1", async () => {
    const a = await createAudience(erste.id, { name: "First" });
    expect(a.key).toBe("aud1");
  });

  it("create with pattern → clean join output", async () => {
    await writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
    const a = await createAudience(erste.id, {
      name: "Mass Market",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");
  });

  it("explicit input.key always wins over pattern", async () => {
    await writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}})",
    );
    const a = await createAudience(erste.id, {
      key: "explicit",
      name: "Override",
      product: "SZA",
      strategy: "Prospecting",
    });
    expect(a.key).toBe("explicit");
  });
});

async function seedTopic(clientId: number, key = "top1") {
  await db
    .insert(topics)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0 });
}

describe("updateAudience — key regen with MC-guard", () => {
  beforeEach(async () => {
    await writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
  });

  it("regenerates key when product changes and no MC references the key", async () => {
    const a = await createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");

    const result = await updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.key).toBe("hk_prospecting_mobile");
  });

  it("does NOT regenerate when an MC references the current key", async () => {
    const a = await createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");
    await seedTopic(erste.id, "top1");
    await createMessage(erste.id, { audience: a.key, topic: "top1" });

    const result = await updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Key kept; product updated.
      expect(result.row.key).toBe("sza_prospecting_mobile");
      expect(result.row.product).toBe("HK");
    }
  });

  it("does NOT regenerate when the referencing MC is archived (still counts)", async () => {
    const a = await createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: a.key, topic: "top1" });
    const archived = await archiveMessage(erste.id, m.id, m.version);
    expect(archived.ok).toBe(true);

    const result = await updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.key).toBe("sza_prospecting_mobile");
  });

  it("regenerates again after the blocking MC is removed", async () => {
    const a = await createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: a.key, topic: "top1" });

    // First update with MC present → key frozen.
    const r1 = await updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.row.key).toBe("sza_prospecting_mobile");

    // Remove the MC and try again — key should now regen.
    await db.delete(messages).where(eq(messages.id, m.id));
    const r2 = await updateAudience(erste.id, a.id, r1.row.version, { device: "Desktop" });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.row.key).toBe("hk_prospecting_desktop");
  });
});

describe("listAudiences — mcCount", () => {
  it("returns mcCount per row (archived OR live)", async () => {
    const a = await createAudience(erste.id, { name: "A" });
    const b = await createAudience(erste.id, { name: "B" });
    await seedTopic(erste.id, "top1");
    await createMessage(erste.id, { audience: a.key, topic: "top1" });
    await createMessage(erste.id, { audience: a.key, topic: "top1" });

    const rows = await listAudiences(erste.id);
    const aRow = rows.find((r) => r.id === a.id);
    const bRow = rows.find((r) => r.id === b.id);
    expect(aRow?.mcCount).toBe(2);
    expect(bRow?.mcCount).toBe(0);
  });
});
