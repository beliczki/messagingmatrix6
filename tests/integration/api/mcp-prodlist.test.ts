import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(
  clientId: number,
  toolName: string,
  scope: "full" | "read" = "full",
): Handler {
  const server = buildMcpServer({ clientId, userId: "test-user", scope });
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

beforeEach(async () => {
  _resetMcpRateLimitForTests();
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("prodlist_upsert + list_prodlist via MCP", () => {
  it("upserts new rows and returns them with version 1", async () => {
    const res = await callTool(erste.id, "prodlist_upsert", {
      rows: [
        { deliverable_id: "DEL-1", channel: "DISP", required_asset: "300x250" },
        { deliverable_id: "DEL-2", channel: "SOC", required_asset: "Single Image" },
      ],
    });
    expect(res.isError).toBe(false);
    expect(res.json).toHaveLength(2);
    expect(res.json.every((r: { version: number }) => r.version === 1)).toBe(true);

    const listed = await callTool(erste.id, "list_prodlist", {});
    expect(listed.json).toHaveLength(2);
  });

  it("re-upserting the same deliverable_id updates in place (version bump, no dup)", async () => {
    await callTool(erste.id, "prodlist_upsert", {
      rows: [{ deliverable_id: "DEL-1", channel: "DISP", campaign: "old" }],
    });
    const second = await callTool(erste.id, "prodlist_upsert", {
      rows: [{ deliverable_id: "DEL-1", channel: "DISP", campaign: "new" }],
    });
    expect(second.json).toHaveLength(1);
    expect(second.json[0].campaign).toBe("new");
    expect(second.json[0].version).toBe(2);

    const listed = await callTool(erste.id, "list_prodlist", {});
    expect(listed.json).toHaveLength(1);
    expect(listed.json[0].campaign).toBe("new");
  });

  it("list_prodlist channel filter narrows to that channel", async () => {
    await callTool(erste.id, "prodlist_upsert", {
      rows: [
        { deliverable_id: "DEL-1", channel: "DISP" },
        { deliverable_id: "DEL-2", channel: "PRG" },
        { deliverable_id: "DEL-3", channel: "DISP" },
      ],
    });
    const disp = await callTool(erste.id, "list_prodlist", { channel: "DISP" });
    expect(disp.json).toHaveLength(2);
    expect(disp.json.every((r: { channel: string }) => r.channel === "DISP")).toBe(
      true,
    );
  });

  it("only returns rows for the active client (tenant isolation)", async () => {
    await callTool(erste.id, "prodlist_upsert", {
      rows: [{ deliverable_id: "DEL-OURS", channel: "DISP" }],
    });
    // same deliverable_id under a different tenant must not collide
    await callTool(telekom.id, "prodlist_upsert", {
      rows: [{ deliverable_id: "DEL-OURS", channel: "SOC" }],
    });

    const ours = await callTool(erste.id, "list_prodlist", {});
    expect(ours.json).toHaveLength(1);
    expect(ours.json[0].channel).toBe("DISP");
  });

  it("list_prodlist available to read scope; prodlist_upsert is not", () => {
    expect(() => getHandler(erste.id, "list_prodlist", "read")).not.toThrow();
    expect(() => getHandler(erste.id, "prodlist_upsert", "read")).toThrow(
      /not registered/,
    );
  });
});
