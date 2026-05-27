import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { assets, clients } from "@/db/schema";
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

function seedAsset(
  clientId: number,
  fields: Partial<typeof assets.$inferInsert> & {
    fileName: string;
  },
) {
  return db
    .insert(assets)
    .values({ clientId, type: "image", brand: "ERSTE", ...fields })
    .returning()
    .get();
}

beforeEach(() => {
  h = createTestDb();
  erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  telekom = db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning()
    .get();
});

afterEach(() => {
  h.cleanup();
});

describe("list_assets via MCP", () => {
  it("file_name_contains is case-insensitive substring match", async () => {
    seedAsset(erste.id, { fileName: "SZA_george_c_sports_fitzone.jpg" });
    seedAsset(erste.id, { fileName: "SZA_george_repter_deviza.jpg" });
    seedAsset(erste.id, { fileName: "TKM_unrelated_banner.jpg" });

    const { json } = await callTool(erste.id, "list_assets", {
      file_name_contains: "GEORGE",
    });
    expect(json).toHaveLength(2);
    expect(json.map((r: { fileName: string }) => r.fileName)).toEqual([
      "SZA_george_c_sports_fitzone.jpg",
      "SZA_george_repter_deviza.jpg",
    ]);
  });

  it("visual_keyword_contains is case-insensitive substring match", async () => {
    seedAsset(erste.id, {
      fileName: "a.jpg",
      visualKeyword: "sports fitzone",
    });
    seedAsset(erste.id, {
      fileName: "b.jpg",
      visualKeyword: "trackers befektetes",
    });
    seedAsset(erste.id, {
      fileName: "c.jpg",
      visualKeyword: "reppter george",
    });

    const { json } = await callTool(erste.id, "list_assets", {
      visual_keyword_contains: "FITZONE",
    });
    expect(json).toHaveLength(1);
    expect(json[0].fileName).toBe("a.jpg");
  });

  it("brand/product/type are AND-combined exact-match filters", async () => {
    seedAsset(erste.id, {
      fileName: "match.jpg",
      brand: "ERSTE",
      product: "SZA",
      type: "image",
    });
    seedAsset(erste.id, {
      fileName: "wrong-product.jpg",
      brand: "ERSTE",
      product: "VAL",
      type: "image",
    });
    seedAsset(erste.id, {
      fileName: "wrong-type.jpg",
      brand: "ERSTE",
      product: "SZA",
      type: "video",
    });

    const { json } = await callTool(erste.id, "list_assets", {
      brand: "ERSTE",
      product: "SZA",
      type: "image",
    });
    expect(json).toHaveLength(1);
    expect(json[0].fileName).toBe("match.jpg");
  });

  it("archived rows excluded by default, included with include_archived=true", async () => {
    seedAsset(erste.id, { fileName: "live.jpg" });
    seedAsset(erste.id, {
      fileName: "archived.jpg",
      archivedAt: "2026-01-01 00:00:00",
    });

    const def = await callTool(erste.id, "list_assets", {});
    expect(def.json.map((r: { fileName: string }) => r.fileName)).toEqual([
      "live.jpg",
    ]);

    const withArchived = await callTool(erste.id, "list_assets", {
      include_archived: true,
    });
    expect(withArchived.json).toHaveLength(2);
  });

  it("only returns rows for the active client (tenant isolation)", async () => {
    seedAsset(erste.id, { fileName: "ours.jpg" });
    seedAsset(telekom.id, { fileName: "theirs.jpg" });

    const { json } = await callTool(erste.id, "list_assets", {});
    expect(json).toHaveLength(1);
    expect(json[0].fileName).toBe("ours.jpg");
  });
});
