import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import {
  createTextFormatting,
  getTextFormatting,
  listTextFormatting,
  matchesScope,
  TextFormattingError,
  updateTextFormatting,
} from "@/lib/entities/text-formatting";
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

describe("text_formatting CRUD", () => {
  it("creates and reads back, scoped per client", async () => {
    const r = await createTextFormatting(erste.id, {
      textOriginal: "AKB",
      textFormatted: "<b>AKB</b>",
      formattingScope: "300x250,728x90",
      formattingMcScope: "MC282a",
    });
    expect(r.clientId).toBe(erste.id);
    expect(r.version).toBe(1);
    expect(await listTextFormatting(telekom.id)).toHaveLength(0);
    expect(await listTextFormatting(erste.id)).toHaveLength(1);
  });

  it("requires textOriginal and textFormatted", async () => {
    await expect(
      createTextFormatting(erste.id, { textFormatted: "x" }),
    ).rejects.toThrow(TextFormattingError);
    await expect(
      createTextFormatting(erste.id, { textOriginal: "x" }),
    ).rejects.toThrow(TextFormattingError);
  });

  it("foreign client cannot update", async () => {
    const t = await createTextFormatting(telekom.id, {
      textOriginal: "x",
      textFormatted: "y",
    });
    const r = await updateTextFormatting(erste.id, t.id, t.version, {
      textFormatted: "hijack",
    });
    expect(r.ok).toBe(false);
    expect((await getTextFormatting(telekom.id, t.id))?.textFormatted).toBe("y");
  });
});

describe("text_formatting matchesScope (Spec §3.6)", () => {
  it("empty scope = universal", async () => {
    const rule = await createTextFormatting(erste.id, {
      textOriginal: "x",
      textFormatted: "y",
      formattingScope: "",
      formattingMcScope: "",
    });
    expect(matchesScope(rule, "300x250", "MC1a")).toBe(true);
    expect(matchesScope(rule, "640x360", "MC999z")).toBe(true);
  });

  it("null scope = universal", async () => {
    const rule = await createTextFormatting(erste.id, {
      textOriginal: "x",
      textFormatted: "y",
    });
    expect(matchesScope(rule, "300x250", "MC1a")).toBe(true);
  });

  it("CSV size scope matches only listed sizes", async () => {
    const rule = await createTextFormatting(erste.id, {
      textOriginal: "x",
      textFormatted: "y",
      formattingScope: "300x250,728x90",
    });
    expect(matchesScope(rule, "300x250", "MC1a")).toBe(true);
    expect(matchesScope(rule, "728x90", "MC1a")).toBe(true);
    expect(matchesScope(rule, "640x360", "MC1a")).toBe(false);
  });

  it("MC scope is case-insensitive", async () => {
    const rule = await createTextFormatting(erste.id, {
      textOriginal: "x",
      textFormatted: "y",
      formattingMcScope: "MC282a MC283b",
    });
    expect(matchesScope(rule, "300x250", "mc282a")).toBe(true);
    expect(matchesScope(rule, "300x250", "MC282A")).toBe(true);
    expect(matchesScope(rule, "300x250", "MC284c")).toBe(false);
  });

  it("size + MC scopes both must match", async () => {
    const rule = await createTextFormatting(erste.id, {
      textOriginal: "x",
      textFormatted: "y",
      formattingScope: "300x250",
      formattingMcScope: "MC1a",
    });
    expect(matchesScope(rule, "300x250", "MC1a")).toBe(true);
    expect(matchesScope(rule, "300x250", "MC1b")).toBe(false);
    expect(matchesScope(rule, "640x360", "MC1a")).toBe(false);
  });
});
