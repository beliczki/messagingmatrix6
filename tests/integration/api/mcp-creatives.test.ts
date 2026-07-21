import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { creatives, clients } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

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

async function seedCreative(
  clientId: number,
  fields: Partial<typeof creatives.$inferInsert> & { fileName: string },
) {
  const [row] = await db
    .insert(creatives)
    .values({ clientId, brand: "ERSTE", ...fields })
    .returning();
  return row;
}

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

describe("list_creatives via MCP", () => {
  it("file_name_contains is case-insensitive substring match", async () => {
    await seedCreative(erste.id, { fileName: "SZA_george_300x250.html" });
    await seedCreative(erste.id, { fileName: "SZA_george_970x250.html" });
    await seedCreative(erste.id, { fileName: "TKM_unrelated_300x250.html" });

    const { json } = await callTool(erste.id, "list_creatives", {
      file_name_contains: "GEORGE",
    });
    expect(json).toHaveLength(2);
    expect(json.map((r: { fileName: string }) => r.fileName)).toEqual([
      "SZA_george_300x250.html",
      "SZA_george_970x250.html",
    ]);
  });

  it("brand/product/type + mc_number are AND-combined filters", async () => {
    await seedCreative(erste.id, {
      fileName: "match.html",
      brand: "ERSTE",
      product: "SZA",
      type: "html5",
      mcNumber: 317,
    });
    await seedCreative(erste.id, {
      fileName: "wrong-number.html",
      brand: "ERSTE",
      product: "SZA",
      type: "html5",
      mcNumber: 318,
    });
    await seedCreative(erste.id, {
      fileName: "wrong-type.html",
      brand: "ERSTE",
      product: "SZA",
      type: "static",
      mcNumber: 317,
    });

    const { json } = await callTool(erste.id, "list_creatives", {
      brand: "ERSTE",
      product: "SZA",
      type: "html5",
      mc_number: 317,
    });
    expect(json).toHaveLength(1);
    expect(json[0].fileName).toBe("match.html");
  });

  it("archived rows excluded by default, included with include_archived=true", async () => {
    await seedCreative(erste.id, { fileName: "live.html" });
    await seedCreative(erste.id, {
      fileName: "archived.html",
      archivedAt: "2026-01-01 00:00:00",
    });

    const def = await callTool(erste.id, "list_creatives", {});
    expect(def.json.map((r: { fileName: string }) => r.fileName)).toEqual([
      "live.html",
    ]);

    const withArchived = await callTool(erste.id, "list_creatives", {
      include_archived: true,
    });
    expect(withArchived.json).toHaveLength(2);
  });

  it("only returns rows for the active client (tenant isolation)", async () => {
    await seedCreative(erste.id, { fileName: "ours.html" });
    await seedCreative(telekom.id, { fileName: "theirs.html" });

    const { json } = await callTool(erste.id, "list_creatives", {});
    expect(json).toHaveLength(1);
    expect(json[0].fileName).toBe("ours.html");
  });
});

describe("creative write tools via MCP", () => {
  it("create → update → remove → restore round-trip", async () => {
    const created = await callTool(erste.id, "creative_create", {
      fields: { fileName: "new_creative.html", product: "SZA", mcNumber: 400 },
    });
    expect(created.isError).toBe(false);
    expect(created.json.fileName).toBe("new_creative.html");
    expect(created.json.version).toBe(1);
    const id = created.json.id;

    const updated = await callTool(erste.id, "creative_update", {
      id,
      version: 1,
      fields: { comment: "reviewed" },
    });
    expect(updated.isError).toBe(false);
    expect(updated.json.comment).toBe("reviewed");
    expect(updated.json.version).toBe(2);

    const removed = await callTool(erste.id, "creative_remove", {
      id,
      version: 2,
    });
    expect(removed.isError).toBe(false);
    expect(removed.json.archived.archivedAt).not.toBeNull();

    const listedAfterRemove = await callTool(erste.id, "list_creatives", {});
    expect(listedAfterRemove.json).toHaveLength(0);

    const restored = await callTool(erste.id, "creative_restore", {
      id,
      version: 3,
    });
    expect(restored.isError).toBe(false);
    expect(restored.json.restored.archivedAt).toBeNull();

    const listedAfterRestore = await callTool(erste.id, "list_creatives", {});
    expect(listedAfterRestore.json).toHaveLength(1);
  });

  it("creative_update returns version_conflict on stale version", async () => {
    const created = await callTool(erste.id, "creative_create", {
      fields: { fileName: "conflict.html" },
    });
    const id = created.json.id;

    const stale = await callTool(erste.id, "creative_update", {
      id,
      version: 99,
      fields: { comment: "x" },
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("version_conflict");
  });

  it("write tools are not registered for read-scoped tokens", () => {
    expect(() => getHandler(erste.id, "creative_create", "read")).toThrow(
      /not registered/,
    );
    expect(() => getHandler(erste.id, "list_creatives", "read")).not.toThrow();
  });
});
