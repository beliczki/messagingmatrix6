import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creatives, clients, uploadedFiles } from "@/db/schema";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
import { _setStorageRootForTests } from "@/lib/storage";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

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
  _resetMcpRateLimitForTests();
  h = await createTestDb();
  _setStorageRootForTests(fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-")));
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
  it("creative_upload stores bytes (category creative) + creates a creatives row", async () => {
    const res = await callTool(erste.id, "creative_upload", {
      filename: "erste_pl_fitzone_300x250.png",
      data_base64: TINY_PNG_B64,
      mc_number: 400,
      mc_variant: "a",
    });
    expect(res.isError).toBe(false);
    expect(res.json.creative.fileName).toBe("erste_pl_fitzone_300x250.png");
    expect(res.json.creative.fileId).toBe(res.json.file.id);
    expect(res.json.creative.mcNumber).toBe(400);
    expect(res.json.creative.mcVariant).toBe("a");
    expect(res.json.creative.version).toBe(1);

    // the stored file is a creative-category uploaded_files row (NOT asset)
    const [uf] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, res.json.file.id));
    expect(uf.category).toBe("creative");

    // and it surfaces through list_creatives, linked by fileId
    const listed = await callTool(erste.id, "list_creatives", {});
    expect(listed.json).toHaveLength(1);
    expect(listed.json[0].fileId).toBe(res.json.file.id);
  });

  it("creative_upload requires exactly one of data_base64 / source_url", async () => {
    const neither = await callTool(erste.id, "creative_upload", {
      filename: "x.png",
    });
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("exactly one");
  });

  it("update → remove → restore round-trip on an existing row", async () => {
    const seeded = await seedCreative(erste.id, { fileName: "seed.html" });
    const id = seeded.id;

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
    const seeded = await seedCreative(erste.id, { fileName: "conflict.html" });

    const stale = await callTool(erste.id, "creative_update", {
      id: seeded.id,
      version: 99,
      fields: { comment: "x" },
    });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("version_conflict");
  });

  it("write tools are not registered for read-scoped tokens", () => {
    expect(() => getHandler(erste.id, "creative_upload", "read")).toThrow(
      /not registered/,
    );
    expect(() => getHandler(erste.id, "list_creatives", "read")).not.toThrow();
  });
});
