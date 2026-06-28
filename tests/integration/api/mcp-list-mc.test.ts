import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { messages, clients } from "@/db/schema";
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
