import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  clients,
  draftMessages,
  draftPreviews,
  topics,
  uploadedFiles,
} from "@/db/schema";
import type { ShootItem } from "@/lib/preview-shooter";
import { createTestDb, type TestDb } from "../../helpers/test-db";

// The chromium shoot is not vitest-testable — shootItems is mocked; its default
// implementation "succeeds" by invoking each item's persist with a fake PNG,
// exercising the real draft_previews insert path. Storage is stubbed so no
// bytes land on disk (everything else on the module stays real).
vi.mock("@/lib/preview-shooter", () => ({
  shootItems: vi.fn(),
  shootPreviews: vi.fn(),
}));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  writeFile: vi.fn(async () => ({
    storagePath: "previews/draft-test.png",
    sha256: "test-sha",
    sizeBytes: 3,
  })),
  deleteStorageFile: vi.fn(async () => {}),
}));

import { shootItems } from "@/lib/preview-shooter";
import { buildMcpServer } from "@/lib/mcp";

let h: TestDb;
let erste: { id: number };

const ORIGIN = "https://erste.messagingmatrix.ai";

async function connect(scope: "full" | "read" = "full") {
  const server = buildMcpServer({
    clientId: erste.id,
    userId: "u",
    scope,
    origin: ORIGIN,
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

type ToolResult = {
  isError?: boolean;
  content: { type: string; text?: string }[];
  structuredContent?: unknown;
};

function parsed(res: ToolResult): any {
  return JSON.parse(res.content[0]!.text!);
}

async function waitForStatus(
  client: Client,
  draftId: number,
  wanted: string,
): Promise<any> {
  for (let i = 0; i < 100; i++) {
    const res = (await client.callTool({
      name: "draft_status",
      arguments: { draft_id: draftId },
    })) as ToolResult;
    const body = parsed(res);
    if (body.status === wanted) return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`draft ${draftId} never reached '${wanted}'`);
}

beforeEach(async () => {
  vi.mocked(shootItems).mockImplementation(
    async (_clientId, items: ShootItem[]) => {
      const out = [];
      for (const item of items) {
        const persisted = await item.persist(Buffer.from("png"));
        out.push({ size: item.size, ok: true as const, ...persisted });
      }
      return out;
    },
  );
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
});

describe("generate_test_creative", () => {
  it("rejects bad size + tag + missing image in ONE error and creates nothing", async () => {
    const client = await connect();
    const res = (await client.callTool({
      name: "generate_test_creative",
      arguments: {
        template: "html",
        sizes: ["300x250", "111x111"],
        template_variant_classes: "fullSurfaceImage notAClass",
        background_images: ["missing.png"],
      },
    })) as ToolResult;
    expect(res.isError).toBe(true);
    const text = res.content[0]!.text!;
    expect(text).toMatch(/111x111/);
    expect(text).toMatch(/notAClass/);
    expect(text).toMatch(/missing\.png/);
    expect(await db.select().from(draftMessages)).toHaveLength(0);
    await client.close();
  });

  it("stages a draft, renders async, and draft_status reaches 100%", async () => {
    await db.insert(uploadedFiles).values({
      id: "f-bg",
      clientId: erste.id,
      filename: "bg.png",
      originalFilename: "bg.png",
      storagePath: "asset/bg.png",
      category: "asset",
    });
    const client = await connect();
    const res = (await client.callTool({
      name: "generate_test_creative",
      arguments: {
        template: "html",
        sizes: ["300x250", "970x250"],
        name: "Agent test",
        headline: "Generated headline",
        cta: "Érdekel",
        flash: "Új!",
        template_variant_classes: "fullSurfaceImage teal",
        background_images: ["bg.png"],
      },
    })) as ToolResult;
    expect(res.isError).toBeFalsy();
    const body = parsed(res);
    expect(body).toMatchObject({
      template: "html",
      status: "rendering",
      sizes: ["300x250", "970x250"],
    });

    const done = await waitForStatus(client, body.draft_id, "done");
    expect(done).toMatchObject({
      total_sizes: 2,
      done_sizes: 2,
      percent: 100,
      errors: {},
    });
    expect(typeof done.elapsed_seconds).toBe("number");
    expect(done.previews).toHaveLength(2);
    expect(
      done.previews.every((p: { url: string }) =>
        p.url.startsWith(`${ORIGIN}/api/draft-previews/`),
      ),
    ).toBe(true);
    await client.close();
  });
});

describe("draft_status / list_drafts / draft_get", () => {
  async function seedDraft(over: Record<string, unknown> = {}) {
    const [d] = await db
      .insert(draftMessages)
      .values({
        clientId: erste.id,
        template: "html",
        sizes: '["300x250","970x250"]',
        headline: "Seeded",
        ...over,
      })
      .returning();
    return d!;
  }

  it("derives percent from the preview rows that already landed", async () => {
    const d = await seedDraft({ renderStatus: "rendering" });
    await db.insert(draftPreviews).values({
      clientId: erste.id,
      draftId: d.id,
      size: "300x250",
      storageKey: "previews/one.png",
    });
    const client = await connect();
    const res = (await client.callTool({
      name: "draft_status",
      arguments: { draft_id: d.id },
    })) as ToolResult;
    expect(parsed(res)).toMatchObject({
      status: "rendering",
      total_sizes: 2,
      done_sizes: 1,
      percent: 50,
    });
    await client.close();
  });

  it("list_drafts hides promoted drafts by default; draft_get returns full fields", async () => {
    const kept = await seedDraft();
    await seedDraft({ promotedMessageId: null });
    const client = await connect();

    const list = parsed(
      (await client.callTool({ name: "list_drafts", arguments: {} })) as ToolResult,
    );
    expect(list).toHaveLength(2);

    const got = parsed(
      (await client.callTool({
        name: "draft_get",
        arguments: { draft_id: kept.id },
      })) as ToolResult,
    );
    expect(got).toMatchObject({
      draft_id: kept.id,
      headline: "Seeded",
      sizes: ["300x250", "970x250"],
      render_errors: {},
      previews: [],
    });
    await client.close();
  });

  it("show_draft_previews returns widget structuredContent with absolute URLs", async () => {
    const d = await seedDraft({ name: "Widget draft", renderStatus: "done" });
    await db.insert(draftPreviews).values([
      { clientId: erste.id, draftId: d.id, size: "300x250", storageKey: "k1" },
      { clientId: erste.id, draftId: d.id, size: "970x250", storageKey: "k2" },
    ]);
    const client = await connect("read");
    const res = (await client.callTool({
      name: "show_draft_previews",
      arguments: { draft_id: d.id },
    })) as ToolResult;
    const sc = res.structuredContent as {
      name: string;
      previews: { label: string; size: string; url: string }[];
    };
    expect(sc.name).toBe("Widget draft");
    expect(sc.previews.map((p) => p.size)).toEqual(["300x250", "970x250"]);
    expect(
      sc.previews.every((p) => p.url.startsWith(`${ORIGIN}/api/draft-previews/`)),
    ).toBe(true);
    await client.close();
  });
});

describe("draft_delete / draft_promote / scopes", () => {
  it("hard-deletes a draft without an explicit version", async () => {
    const [d] = await db
      .insert(draftMessages)
      .values({ clientId: erste.id, template: "html", sizes: '["300x250"]' })
      .returning();
    const client = await connect();
    const res = (await client.callTool({
      name: "draft_delete",
      arguments: { draft_id: d!.id },
    })) as ToolResult;
    expect(parsed(res)).toEqual({ ok: true, deleted: d!.id });
    expect(await db.select().from(draftMessages)).toHaveLength(0);
    await client.close();
  });

  it("promotes into the matrix once, refuses the second time", async () => {
    await db.insert(audiences).values({
      clientId: erste.id,
      key: "VAL_x",
      name: "Val X",
      orderIndex: 1,
    });
    await db.insert(topics).values({
      clientId: erste.id,
      key: "topic_one",
      name: "Topic One",
      orderIndex: 1,
    });
    const [d] = await db
      .insert(draftMessages)
      .values({
        clientId: erste.id,
        template: "html",
        sizes: '["300x250"]',
        headline: "Promote me",
      })
      .returning();
    const client = await connect();
    const first = (await client.callTool({
      name: "draft_promote",
      arguments: { draft_id: d!.id, audience_key: "VAL_x", topic_key: "topic_one" },
    })) as ToolResult;
    expect(first.isError).toBeFalsy();
    const body = parsed(first);
    expect(body.message).toMatchObject({
      number: 1,
      variant: "a",
      headline: "Promote me",
      audience: "VAL_x",
      topic: "topic_one",
    });
    expect(body.draft.promoted_message_id).toBe(body.message.id);

    const second = (await client.callTool({
      name: "draft_promote",
      arguments: { draft_id: d!.id, audience_key: "VAL_x", topic_key: "topic_one" },
    })) as ToolResult;
    expect(second.isError).toBe(true);
    expect(second.content[0]!.text).toMatch(/already promoted/);
    await client.close();
  });

  it("read scope sees the draft read tools but not the writes", async () => {
    const client = await connect("read");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_drafts",
        "draft_get",
        "draft_status",
        "show_draft_previews",
      ]),
    );
    expect(names).not.toContain("generate_test_creative");
    expect(names).not.toContain("draft_delete");
    expect(names).not.toContain("draft_promote");
    await client.close();
  });
});
