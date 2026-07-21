import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/db";
import { clients, messages, messagePreviews } from "@/db/schema";
import { uploadFile } from "@/lib/entities/files";
import { _setStorageRootForTests } from "@/lib/storage";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };
let msgId: number;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=",
  "base64",
);

type Block =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

function getHandler(clientId: number, toolName: string) {
  const server = buildMcpServer({ clientId, userId: "test-user", scope: "full" });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: Record<string, unknown>) => Promise<{ content: Block[]; isError?: boolean }> }>;
  })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  return tool.handler;
}

async function call(clientId: number, toolName: string, args: Record<string, unknown>) {
  const res = await getHandler(clientId, toolName)(args);
  return { isError: !!res.isError, content: res.content };
}

beforeEach(async () => {
  h = await createTestDb();
  _setStorageRootForTests(fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-")));
  withActiveClientKey("erste");
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  const [m] = await db
    .insert(messages)
    .values({ clientId: erste.id, number: 244, variant: "d", audience: "HK_wlfin", topic: "top1", versionNo: 1, pmmid: "PMM-244d" })
    .returning({ id: messages.id });
  msgId = m.id;
});

afterEach(async () => {
  await h.cleanup();
});

// Write real bytes into the test storage and return the storagePath to reference.
async function storePng(clientId: number) {
  const file = await uploadFile(clientId, {
    buffer: TINY_PNG,
    originalFilename: "prev.png",
    mimeType: "image/png",
    category: "creative",
    uploadedBy: "t",
    dimensions: "1x1",
  });
  return file.storagePath;
}

describe("get_mc_preview_files via MCP", () => {
  it("returns native image content per generated size, with a naming text line", async () => {
    const key = await storePng(erste.id);
    await db.insert(messagePreviews).values([
      { clientId: erste.id, messageId: msgId, size: "300x250", storageKey: key, messageVersion: 1 },
      { clientId: erste.id, messageId: msgId, size: "970x250", storageKey: key, messageVersion: 1 },
    ]);

    const { isError, content } = await call(erste.id, "get_mc_preview_files", { mc_label: "PMM-244d" });
    expect(isError).toBeFalsy();
    const images = content.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].mimeType).toBe("image/png");
    expect(images[0].data).toBe(TINY_PNG.toString("base64"));
    // a text label names each file
    const texts = content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    expect(texts.some((t) => t.includes("PMM-244d_300x250.png"))).toBe(true);
  });

  it("sizes filter narrows to the requested size", async () => {
    const key = await storePng(erste.id);
    await db.insert(messagePreviews).values([
      { clientId: erste.id, messageId: msgId, size: "300x250", storageKey: key, messageVersion: 1 },
      { clientId: erste.id, messageId: msgId, size: "970x250", storageKey: key, messageVersion: 1 },
    ]);

    const { content } = await call(erste.id, "get_mc_preview_files", { mc_number: 244, variant: "d", sizes: ["970x250"] });
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(1);
    const texts = content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    expect(texts.some((t) => t.includes("970x250"))).toBe(true);
    expect(texts.some((t) => t.includes("300x250"))).toBe(false);
  });

  it("dedupes preview sizes across audience copies (one image per size)", async () => {
    const key = await storePng(erste.id);
    const [m2] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 244, variant: "d", audience: "SZK_x", topic: "top1", versionNo: 1, pmmid: "PMM-244d-2" })
      .returning({ id: messages.id });
    await db.insert(messagePreviews).values([
      { clientId: erste.id, messageId: msgId, size: "300x250", storageKey: key, messageVersion: 1 },
      { clientId: erste.id, messageId: m2.id, size: "300x250", storageKey: key, messageVersion: 1 },
    ]);

    const { content } = await call(erste.id, "get_mc_preview_files", { mc_number: 244, variant: "d" });
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(1); // one 300x250, not two
  });

  it("no generated previews → error", async () => {
    const res = await call(erste.id, "get_mc_preview_files", { mc_label: "PMM-244d" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("preview_generate");
  });

  it("no MC match → error", async () => {
    const res = await call(erste.id, "get_mc_preview_files", { mc_label: "NOPE" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("no MC matched");
  });

  it("validation: exactly one of mc_label / mc_number", async () => {
    const res = await call(erste.id, "get_mc_preview_files", {});
    expect(res.isError).toBe(true);
  });
});

describe("get_media_file via MCP", () => {
  it("returns image content for an image asset by file_name", async () => {
    await uploadFile(erste.id, {
      buffer: TINY_PNG,
      originalFilename: "hk_banner.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "t",
      dimensions: "1x1",
    });

    const { isError, content } = await call(erste.id, "get_media_file", { file_name: "hk_banner.png" });
    expect(isError).toBeFalsy();
    const img = content.find((b) => b.type === "image") as Extract<Block, { type: "image" }>;
    expect(img.mimeType).toBe("image/png");
    expect(img.data).toBe(TINY_PNG.toString("base64"));
  });

  it("non-image file → error naming the mime type", async () => {
    await uploadFile(erste.id, {
      buffer: Buffer.from("PKzip"),
      originalFilename: "bundle.zip",
      mimeType: "application/zip",
      category: "creative",
      uploadedBy: "t",
    });
    const res = await call(erste.id, "get_media_file", { file_name: "bundle.zip" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("application/zip");
  });

  it("unknown file_name → error", async () => {
    const res = await call(erste.id, "get_media_file", { file_name: "missing.png" });
    expect(res.isError).toBe(true);
  });

  it("tenant isolation: another client's file is not returned", async () => {
    await uploadFile(telekom.id, {
      buffer: TINY_PNG,
      originalFilename: "theirs.png",
      mimeType: "image/png",
      category: "asset",
      uploadedBy: "t",
      dimensions: "1x1",
    });
    const res = await call(erste.id, "get_media_file", { file_name: "theirs.png" });
    expect(res.isError).toBe(true);
  });
});
