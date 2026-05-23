import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
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

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  withActiveClientKey("erste");
});

afterEach(() => {
  h.cleanup();
});

function writeAudiencePattern(clientId: number, pattern: string | null) {
  const value = JSON.stringify(pattern === null ? {} : { audienceKey: pattern });
  db.insert(config)
    .values({ clientId, key: "patterns", category: "patterns", value })
    .onConflictDoUpdate({
      target: [config.clientId, config.key],
      set: { value },
    })
    .run();
}

describe("generateAudienceKey", () => {
  it("falls back to aud{N+1} when no pattern is configured", () => {
    expect(
      generateAudienceKey(
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

  it("uses the configured pattern with join()", () => {
    writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
    expect(
      generateAudienceKey(
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

  it("join() drops empty + 'NA' values cleanly", () => {
    writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}}, {{tag|lower}})",
    );
    expect(
      generateAudienceKey(
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

  it("empty pattern output falls back to aud{N+1}", () => {
    writeAudiencePattern(erste.id, "join({{strategy}}, {{device}})");
    expect(
      generateAudienceKey(
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
  it("create with no explicit key + no pattern → aud1", () => {
    const a = createAudience(erste.id, { name: "First" });
    expect(a.key).toBe("aud1");
  });

  it("create with pattern → clean join output", () => {
    writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
    const a = createAudience(erste.id, {
      name: "Mass Market",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");
  });

  it("explicit input.key always wins over pattern", () => {
    writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}})",
    );
    const a = createAudience(erste.id, {
      key: "explicit",
      name: "Override",
      product: "SZA",
      strategy: "Prospecting",
    });
    expect(a.key).toBe("explicit");
  });
});

function seedTopic(clientId: number, key = "top1") {
  db.insert(topics)
    .values({ clientId, key, name: key.toUpperCase(), orderIndex: 0 })
    .run();
}

describe("updateAudience — key regen with MC-guard", () => {
  beforeEach(() => {
    writeAudiencePattern(
      erste.id,
      "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
    );
  });

  it("regenerates key when product changes and no MC references the key", () => {
    const a = createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");

    const result = updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.key).toBe("hk_prospecting_mobile");
  });

  it("does NOT regenerate when an MC references the current key", () => {
    const a = createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    expect(a.key).toBe("sza_prospecting_mobile");
    seedTopic(erste.id, "top1");
    createMessage(erste.id, { audience: a.key, topic: "top1" });

    const result = updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Key kept; product updated.
      expect(result.row.key).toBe("sza_prospecting_mobile");
      expect(result.row.product).toBe("HK");
    }
  });

  it("does NOT regenerate when the referencing MC is archived (still counts)", () => {
    const a = createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    seedTopic(erste.id, "top1");
    const m = createMessage(erste.id, { audience: a.key, topic: "top1" });
    const archived = archiveMessage(erste.id, m.id, m.version);
    expect(archived.ok).toBe(true);

    const result = updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.key).toBe("sza_prospecting_mobile");
  });

  it("regenerates again after the blocking MC is removed", () => {
    const a = createAudience(erste.id, {
      name: "A",
      product: "SZA",
      strategy: "Prospecting",
      device: "Mobile",
    });
    seedTopic(erste.id, "top1");
    const m = createMessage(erste.id, { audience: a.key, topic: "top1" });

    // First update with MC present → key frozen.
    const r1 = updateAudience(erste.id, a.id, a.version, { product: "HK" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.row.key).toBe("sza_prospecting_mobile");

    // Remove the MC and try again — key should now regen.
    db.delete(messages).where(eq(messages.id, m.id)).run();
    const r2 = updateAudience(erste.id, a.id, r1.row.version, { device: "Desktop" });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.row.key).toBe("hk_prospecting_desktop");
  });
});

describe("listAudiences — mcCount", () => {
  it("returns mcCount per row (archived OR live)", () => {
    const a = createAudience(erste.id, { name: "A" });
    const b = createAudience(erste.id, { name: "B" });
    seedTopic(erste.id, "top1");
    createMessage(erste.id, { audience: a.key, topic: "top1" });
    createMessage(erste.id, { audience: a.key, topic: "top1" });

    const rows = listAudiences(erste.id);
    const aRow = rows.find((r) => r.id === a.id);
    const bRow = rows.find((r) => r.id === b.id);
    expect(aRow?.mcCount).toBe(2);
    expect(bRow?.mcCount).toBe(0);
  });
});
