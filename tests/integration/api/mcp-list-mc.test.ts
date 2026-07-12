import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, messagePreviews, clients } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(clientId: number, toolName: string): Handler {
  const server = buildMcpServer({ clientId });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  return tool.handler;
}

async function callTool(
  clientId: number,
  toolName: string,
  args: Record<string, unknown>,
) {
  const res = await getHandler(clientId, toolName)(args);
  const text = res.content[0]?.text ?? "";
  return {
    isError: !!res.isError,
    text,
    json: res.isError ? null : JSON.parse(text),
  };
}

async function seedMc(clientId: number, number: number) {
  await db.insert(messages).values({
    clientId,
    number,
    variant: "a",
    audience: "aud1",
    topic: "top1",
    versionNo: 1,
    pmmid: `pmm-${number}`,
    name: `MC ${number}`,
    headline: `Headline ${number}`,
    copy1: `Long body copy for ${number} `.repeat(20),
    customCss: ".x{color:red}",
    image1: `https://cdn/${number}.jpg`,
  });
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("list_mc via MCP", () => {
  it("returns a lean projection by default (no heavy blobs)", async () => {
    await seedMc(erste.id, 1);
    const { json } = await callTool(erste.id, "list_mc", {});
    expect(json).toHaveLength(1);
    const row = json[0];
    // Lean fields present...
    expect(row.number).toBe(1);
    expect(row.pmmid).toBe("pmm-1");
    expect(row.headline).toBe("Headline 1");
    // ...heavy blobs absent.
    expect(row).not.toHaveProperty("copy1");
    expect(row).not.toHaveProperty("customCss");
    expect(row).not.toHaveProperty("image1");
  });

  it("verbose=true returns the full row incl. blobs", async () => {
    await seedMc(erste.id, 1);
    const { json } = await callTool(erste.id, "list_mc", { verbose: true });
    expect(json[0]).toHaveProperty("copy1");
    expect(json[0]).toHaveProperty("customCss", ".x{color:red}");
    expect(json[0].image1).toBe("https://cdn/1.jpg");
  });

  it("limit can be overridden past the old 100 default", async () => {
    for (let n = 1; n <= 120; n++) await seedMc(erste.id, n);
    const def = await callTool(erste.id, "list_mc", {});
    expect(def.json).toHaveLength(100); // default still 100
    const all = await callTool(erste.id, "list_mc", { limit: 5000 });
    expect(all.json).toHaveLength(120);
  });

  it("carries preview_urls as a {size: url} map, {} when none generated", async () => {
    await seedMc(erste.id, 1);
    await seedMc(erste.id, 2);
    const [mc1] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.number, 1));
    const [p300, p970] = await db
      .insert(messagePreviews)
      .values([
        {
          clientId: erste.id,
          messageId: mc1!.id,
          size: "300x250",
          storageKey: "erste/previews/2026/07/a.png",
          messageVersion: 1,
        },
        {
          clientId: erste.id,
          messageId: mc1!.id,
          size: "970x250",
          storageKey: "erste/previews/2026/07/b.png",
          messageVersion: 1,
        },
      ])
      .returning();

    const { json } = await callTool(erste.id, "list_mc", {});
    const row1 = json.find((r: { number: number }) => r.number === 1);
    const row2 = json.find((r: { number: number }) => r.number === 2);
    expect(row1.preview_urls).toEqual({
      "300x250": `/api/previews/${p300!.id}`,
      "970x250": `/api/previews/${p970!.id}`,
    });
    expect(row2.preview_urls).toEqual({});
  });

  it("prefixes preview_urls with the ctx origin when present", async () => {
    await seedMc(erste.id, 1);
    const [mc1] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.number, 1));
    const [p] = await db
      .insert(messagePreviews)
      .values({
        clientId: erste.id,
        messageId: mc1!.id,
        size: "300x250",
        storageKey: "erste/previews/2026/07/a.png",
        messageVersion: 1,
      })
      .returning();

    const server = buildMcpServer({
      clientId: erste.id,
      origin: "https://erste.messagingmatrix.ai",
    });
    const registry = (server as unknown as {
      _registeredTools: Record<string, { handler: Handler }>;
    })._registeredTools;
    const res = await registry.list_mc!.handler({});
    const json = JSON.parse(res.content[0]!.text);
    expect(json[0].preview_urls["300x250"]).toBe(
      `https://erste.messagingmatrix.ai/api/previews/${p!.id}`,
    );
  });

  it("offset paging is gap-free and reconstructs the full set", async () => {
    for (let n = 1; n <= 10; n++) await seedMc(erste.id, n);
    const p1 = await callTool(erste.id, "list_mc", { limit: 4, offset: 0 });
    const p2 = await callTool(erste.id, "list_mc", { limit: 4, offset: 4 });
    const p3 = await callTool(erste.id, "list_mc", { limit: 4, offset: 8 });
    const nums = [...p1.json, ...p2.json, ...p3.json].map(
      (r: { number: number }) => r.number,
    );
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // ordered, no gaps/dupes
  });
});
