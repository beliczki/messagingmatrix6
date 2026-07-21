import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { messages, messagePreviews, clients } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(clientId: number, toolName: string): Handler {
  const server = buildMcpServer({ clientId, userId: "test-user", scope: "full" });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  return tool.handler;
}

async function callTool(clientId: number, toolName: string, args: Record<string, unknown>) {
  const res = await getHandler(clientId, toolName)(args);
  const text = res.content[0]?.text ?? "";
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

async function seedMc(
  clientId: number,
  m: {
    number: number;
    variant: string;
    pmmid: string;
    audience?: string;
    topic?: string;
    archivedAt?: string | null;
  },
) {
  const [row] = await db
    .insert(messages)
    .values({
      clientId,
      number: m.number,
      variant: m.variant,
      audience: m.audience ?? "aud1",
      topic: m.topic ?? "top1",
      versionNo: 1,
      pmmid: m.pmmid,
      archivedAt: m.archivedAt ?? null,
    })
    .returning({ id: messages.id });
  return row.id;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("mc_get via MCP", () => {
  it("mc_label yields a single-element array with preview_urls", async () => {
    const id = await seedMc(erste.id, { number: 1, variant: "a", pmmid: "PMM-1a" });
    const [p] = await db
      .insert(messagePreviews)
      .values({
        clientId: erste.id,
        messageId: id,
        size: "300x250",
        storageKey: "erste/previews/a.png",
        messageVersion: 1,
      })
      .returning();

    const { json } = await callTool(erste.id, "mc_get", { mc_label: "PMM-1a" });
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
    expect(json[0].pmmid).toBe("PMM-1a");
    expect(json[0].preview_urls["300x250"]).toMatch(
      new RegExp(`^/api/previews/${p!.id}\\?v=[0-9a-f]{10}$`),
    );
  });

  it("mc_number returns every variant/cell of that number, ordered by number,variant", async () => {
    // number 1 lives in two cells / variants; number 2 unrelated
    await seedMc(erste.id, { number: 1, variant: "a", pmmid: "PMM-1a", audience: "aud1" });
    await seedMc(erste.id, { number: 1, variant: "b", pmmid: "PMM-1b", audience: "aud2" });
    await seedMc(erste.id, { number: 2, variant: "a", pmmid: "PMM-2a" });

    const { json } = await callTool(erste.id, "mc_get", { mc_number: 1 });
    expect(json.map((r: { pmmid: string }) => r.pmmid)).toEqual(["PMM-1a", "PMM-1b"]);
    // each row carries a preview_urls map (empty when none generated)
    expect(json[0].preview_urls).toEqual({});
  });

  it("mc_number + variant narrows to that variant", async () => {
    await seedMc(erste.id, { number: 1, variant: "a", pmmid: "PMM-1a" });
    await seedMc(erste.id, { number: 1, variant: "b", pmmid: "PMM-1b" });

    const { json } = await callTool(erste.id, "mc_get", { mc_number: 1, variant: "b" });
    expect(json).toHaveLength(1);
    expect(json[0].pmmid).toBe("PMM-1b");
  });

  it("archived rows excluded by default, included with include_archived=true", async () => {
    await seedMc(erste.id, { number: 5, variant: "a", pmmid: "PMM-5a" });
    await seedMc(erste.id, {
      number: 5,
      variant: "b",
      pmmid: "PMM-5b",
      archivedAt: "2026-01-01 00:00:00",
    });

    const def = await callTool(erste.id, "mc_get", { mc_number: 5 });
    expect(def.json.map((r: { pmmid: string }) => r.pmmid)).toEqual(["PMM-5a"]);

    const withArchived = await callTool(erste.id, "mc_get", {
      mc_number: 5,
      include_archived: true,
    });
    expect(withArchived.json).toHaveLength(2);
  });

  it("no match → empty array", async () => {
    const byLabel = await callTool(erste.id, "mc_get", { mc_label: "NOPE" });
    expect(byLabel.json).toEqual([]);
    const byNumber = await callTool(erste.id, "mc_get", { mc_number: 999 });
    expect(byNumber.json).toEqual([]);
  });

  it("tenant isolation: another client's MC is not returned", async () => {
    await seedMc(telekom.id, { number: 1, variant: "a", pmmid: "PMM-1a" });
    const { json } = await callTool(erste.id, "mc_get", { mc_number: 1 });
    expect(json).toEqual([]);
  });

  it("validation: exactly one of mc_label / mc_number, variant requires mc_number", async () => {
    const neither = await callTool(erste.id, "mc_get", {});
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("exactly one");

    const both = await callTool(erste.id, "mc_get", { mc_label: "x", mc_number: 1 });
    expect(both.isError).toBe(true);

    const orphanVariant = await callTool(erste.id, "mc_get", { mc_label: "x", variant: "a" });
    expect(orphanVariant.isError).toBe(true);
    expect(orphanVariant.text).toContain("variant");
  });
});
