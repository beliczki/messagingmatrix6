import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/db";
import { clients, config as configTable, messages } from "@/db/schema";
import type { StalePreview } from "@/lib/previews";
import { createTestDb, type TestDb } from "../../helpers/test-db";

vi.mock("@/lib/preview-shooter", () => ({
  shootPreviews: vi.fn(async (_clientId: number, items: StalePreview[]) =>
    items.map((it, i) => ({
      messageId: it.message.id,
      size: it.size,
      ok: true as const,
      previewId: 100 + i,
    })),
  ),
}));

import { shootPreviews } from "@/lib/preview-shooter";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";

let h: TestDb;
let erste: { id: number };

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(
  clientId: number,
  toolName: string,
  origin?: string,
): Handler {
  const server = buildMcpServer({ clientId, userId: "test-user", scope: "full", origin });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  return tool.handler;
}

async function seedHtmlMessage(number: number) {
  const [m] = await db
    .insert(messages)
    .values({
      clientId: erste.id,
      number,
      variant: "a",
      audience: "aud1",
      topic: "top1",
      pmmid: `pmm-${number}`,
      template: "html",
    })
    .returning();
  return m!;
}

beforeEach(async () => {
  vi.mocked(shootPreviews).mockClear();
  _resetMcpRateLimitForTests();
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("preview_generate via MCP", () => {
  it("generates per-label results with origin-prefixed urls", async () => {
    const m1 = await seedHtmlMessage(1);
    const handler = getHandler(
      erste.id,
      "preview_generate",
      "https://erste.messagingmatrix.ai",
    );
    const res = await handler({ mc_labels: ["pmm-1"] });
    const json = JSON.parse(res.content[0]!.text);
    expect(json).toHaveLength(1);
    expect(json[0].mc_label).toBe("pmm-1");
    // html template: 4 sizes, all missing → all generated.
    expect(Object.keys(json[0].generated)).toHaveLength(4);
    for (const url of Object.values(json[0].generated)) {
      expect(url).toMatch(
        /^https:\/\/erste\.messagingmatrix\.ai\/api\/previews\/\d+$/,
      );
    }
    expect(json[0].skipped_fresh).toEqual([]);
    expect(json[0].errors).toEqual({});
    const passedItems = vi.mocked(shootPreviews).mock.calls[0]![1];
    expect(passedItems.every((it) => it.message.id === m1.id)).toBe(true);
  });

  it("unknown labels get a per-label error entry, not isError", async () => {
    await seedHtmlMessage(1);
    const handler = getHandler(erste.id, "preview_generate");
    const res = await handler({ mc_labels: ["pmm-1", "TYPO"] });
    expect(res.isError).toBeFalsy();
    const json = JSON.parse(res.content[0]!.text);
    expect(json).toHaveLength(2);
    expect(json[1]).toEqual({
      mc_label: "TYPO",
      error: "message 'TYPO' not found",
    });
  });

  it("reports failed sizes under errors and fresh sizes under skipped_fresh", async () => {
    const m1 = await seedHtmlMessage(1);
    vi.mocked(shootPreviews).mockImplementationOnce(
      async (_clientId: number, items: StalePreview[]) =>
        items.map((it, i) =>
          i === 0
            ? {
                messageId: it.message.id,
                size: it.size,
                ok: false as const,
                error: "timeout",
              }
            : {
                messageId: it.message.id,
                size: it.size,
                ok: true as const,
                previewId: 200 + i,
              },
        ),
    );
    // one fresh size → skipped by the stale scan
    const { messagePreviews } = await import("@/db/schema");
    await db.insert(messagePreviews).values({
      clientId: erste.id,
      messageId: m1.id,
      size: "300x250",
      storageKey: "erste/previews/a.png",
      messageVersion: m1.version,
    });

    const handler = getHandler(erste.id, "preview_generate");
    const res = await handler({ mc_labels: ["pmm-1"] });
    const json = JSON.parse(res.content[0]!.text);
    expect(json[0].skipped_fresh).toContain("300x250");
    expect(Object.keys(json[0].errors)).toHaveLength(1);
    expect(Object.values(json[0].errors)[0]).toBe("timeout");
    expect(Object.keys(json[0].generated)).toHaveLength(2); // 4 - 1 fresh - 1 failed
  });

  it("consumes the write rate limit", async () => {
    await seedHtmlMessage(1);
    await db.insert(configTable).values({
      clientId: erste.id,
      key: "mcp.rateLimit",
      value: "1",
    });
    const handler = getHandler(erste.id, "preview_generate");
    await handler({ mc_labels: ["pmm-1"] });
    const res = await handler({ mc_labels: ["pmm-1"] });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("rate_limited");
  });
});
