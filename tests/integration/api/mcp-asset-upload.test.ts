import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, clients, config as configTable, uploadedFiles } from "@/db/schema";
import { getFileByFilename } from "@/lib/entities/files";
import { _setStorageRootForTests } from "@/lib/storage";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(clientId: number): Handler {
  const server = buildMcpServer({ clientId });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  return registry.asset_upload!.handler;
}

async function call(args: Record<string, unknown>) {
  const res = await getHandler(erste.id)(args);
  return {
    isError: !!res.isError,
    text: res.content[0]?.text ?? "",
    json: res.isError ? null : JSON.parse(res.content[0]!.text),
  };
}

beforeEach(async () => {
  _resetMcpRateLimitForTests();
  h = await createTestDb();
  _setStorageRootForTests(fs.mkdtempSync(path.join(os.tmpdir(), "mm6-storage-")));
  withActiveClientKey("erste");
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
  vi.unstubAllGlobals();
});

describe("asset_upload via MCP", () => {
  it("base64 happy path: uploaded_files + assets rows, parsed metadata", async () => {
    const { isError, json } = await call({
      filename: "erste_pl_fitzone.png",
      data_base64: TINY_PNG_B64,
    });
    expect(isError).toBe(false);
    expect(json.file.filename).toBe("erste_pl_fitzone.png");
    expect(json.file.dimensions).toBe("1x1");
    expect(json.file.deduplicated).toBe(false);
    // default parsing rules: brand=segment0, product=segment1, type=ext type
    expect(json.asset).toMatchObject({
      brand: "erste",
      product: "pl",
      type: "image",
      fileName: "erste_pl_fitzone.png",
      fileFormat: "png",
    });
    const [fileRow] = await db
      .select()
      .from(uploadedFiles)
      .where(eq(uploadedFiles.id, json.file.id));
    expect(fileRow).toMatchObject({ category: "asset", uploadedBy: `mcp:${erste.id}` });
    const [assetRow] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, json.asset.id));
    expect(assetRow!.fileId).toBe(json.file.id);
  });

  it("explicit metadata overrides parsed values", async () => {
    const { json } = await call({
      filename: "erste_pl_fitzone.png",
      data_base64: TINY_PNG_B64,
      brand: "George",
      visual_keyword: "sport",
    });
    expect(json.asset.brand).toBe("George");
    expect(json.asset.product).toBe("pl"); // still parsed
    expect(json.asset.visualKeyword).toBe("sport");
  });

  it("rejects duplicate filenames unless replace_existing", async () => {
    const first = await call({ filename: "banner.png", data_base64: TINY_PNG_B64 });
    // createdAt has 1s granularity — backdate so "newest wins" is deterministic
    // (sub-second replacement ties are inherent to filename resolution).
    await db
      .update(uploadedFiles)
      .set({ createdAt: "2026-01-01 00:00:00" })
      .where(eq(uploadedFiles.id, first.json.file.id));
    const dup = await call({ filename: "banner.png", data_base64: TINY_PNG_B64 });
    expect(dup.isError).toBe(true);
    expect(dup.text).toContain("filename_exists");

    const replaced = await call({
      filename: "banner.png",
      data_base64: TINY_PNG_B64,
      replace_existing: true,
    });
    expect(replaced.isError).toBe(false);
    // identical bytes → dedup against the first upload's object
    expect(replaced.json.file.deduplicated).toBe(true);
    const resolved = await getFileByFilename(erste.id, "banner.png");
    expect(resolved!.id).toBe(replaced.json.file.id); // newest wins
  });

  it("requires exactly one of data_base64 / source_url", async () => {
    const neither = await call({ filename: "x.png" });
    expect(neither.isError).toBe(true);
    const both = await call({
      filename: "x.png",
      data_base64: TINY_PNG_B64,
      source_url: "https://example.com/x.png",
    });
    expect(both.isError).toBe(true);
  });

  it("rejects oversized base64 with a pointer to source_url", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
    const res = await call({ filename: "big.png", data_base64: big });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("source_url");
  });

  it("source_url path downloads and stores; SSRF-guards private addresses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(Buffer.from(TINY_PNG_B64, "base64"), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const ok = await call({
      filename: "remote_pl_kep.png",
      source_url: "https://example.com/kep.png",
    });
    expect(ok.isError).toBe(false);
    expect(ok.json.file.dimensions).toBe("1x1");

    for (const bad of [
      "http://127.0.0.1/x.png",
      "http://192.168.1.5/x.png",
      "http://169.254.169.254/latest/meta-data",
      "ftp://example.com/x.png",
      "http://localhost/x.png",
    ]) {
      const res = await call({ filename: `ssrf.png`, source_url: bad });
      expect(res.isError).toBe(true);
      expect(res.text).toContain("source_url fetch failed");
    }
  });

  it("re-validates redirect hops (302 to a private address is refused)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:9000/mm6-files/secret" },
        }),
      ),
    );
    const res = await call({
      filename: "redir.png",
      source_url: "https://example.com/kep.png",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("private");
  });

  it("consumes the write rate limit", async () => {
    await db.insert(configTable).values({
      clientId: erste.id,
      key: "mcp.rateLimit",
      value: "1",
    });
    await call({ filename: "a.png", data_base64: TINY_PNG_B64 });
    const res = await call({ filename: "b.png", data_base64: TINY_PNG_B64 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("rate_limited");
  });
});
