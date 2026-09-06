import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The chromium shoot is not vitest-testable, so the shooter is mocked. Its
// absence is also what these tests want: rendering is fire-and-forget, and the
// point being checked is that the DRAFT ROW and its claimed number exist the
// moment the tool returns, whether or not a PNG ever lands.
vi.mock("@/lib/preview-shooter", async (orig) => {
  const actual = await orig<typeof import("@/lib/preview-shooter")>();
  return { ...actual, shootPreviews: vi.fn(async () => []) };
});

import { db } from "@/db";
import { clients, audiences, topics, messages } from "@/db/schema";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

const DECK = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

function getHandler(clientId: number, toolName: string): Handler {
  const server = buildMcpServer({ clientId, userId: "test-user", scope: "full" });
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
  await db.insert(audiences).values({
    clientId: erste.id,
    key: "SZK_visitors",
    name: "Visitors",
    product: "SZK",
    orderIndex: 1,
  });
  await db.insert(topics).values({
    clientId: erste.id,
    key: "SZK_brand",
    name: "Brand",
    product: "SZK",
    orderIndex: 1,
  });
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

describe("generate_test_creative", () => {
  it("claims an MC number and returns it with the draft", async () => {
    const res = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      headline: "Agent copy",
    });
    expect(res.isError).toBe(false);
    expect(res.json.draft_id).toBeGreaterThan(0);
    expect(res.json.mc_label).toMatch(/^MC\d+a$/);
    expect(res.json.mc_number).toBeGreaterThan(0);

    const [row] = await db.select().from(messages);
    expect(row).toMatchObject({
      status: "DRAFT",
      audience: null,
      headline: "Agent copy",
      pmmid: null,
    });
  });

  it("records the brief and the working topic in the same call", async () => {
    const res = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      brief_link: `https://docs.google.com/presentation/d/${DECK}/edit`,
      working_topic: "társasház (munkacím)",
    });
    expect(res.isError).toBe(false);
    const [row] = await db.select().from(messages);
    expect(row!.briefSlidesFileId).toBe(DECK);
    expect(row!.topic).toBe("társasház (munkacím)");
  });

  it("reports every input problem at once and creates nothing", async () => {
    const res = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      sizes: ["1x1", "2x2"],
      template_variant_classes: "notAToken",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/unknown size/);
    expect(res.text).toMatch(/unknown template_variant_classes/);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("refuses a template that is not html", async () => {
    const res = await callTool(erste.id, "generate_test_creative", {
      template: "definitely-not-a-template",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
  });
});

describe("the claimed number is really held", () => {
  it("blocks mc_create from taking it", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const res = await callTool(erste.id, "mc_create", {
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
      mc_number: draft.json.mc_number,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/reserved by a draft/);
  });
});

describe("list_drafts / draft_get / draft_status", () => {
  it("lists open drafts and drops them once promoted", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      name: "One",
    });
    expect((await callTool(erste.id, "list_drafts", {})).json).toHaveLength(1);

    await callTool(erste.id, "draft_promote", {
      draft_id: draft.json.draft_id,
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
    });
    // Once placed it is an ordinary MC — list_mc's job, not list_drafts'.
    expect((await callTool(erste.id, "list_drafts", {})).json).toHaveLength(0);
  });

  it("draft_get returns the content and the claimed label", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      headline: "Look at this",
    });
    const got = await callTool(erste.id, "draft_get", {
      draft_id: draft.json.draft_id,
    });
    expect(got.json).toMatchObject({
      headline: "Look at this",
      mc_label: draft.json.mc_label,
      status: "DRAFT",
    });
  });

  it("draft_status reports pending while no preview has landed", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const st = await callTool(erste.id, "draft_status", {
      draft_id: draft.json.draft_id,
    });
    expect(st.json).toMatchObject({ status: "pending", done_sizes: 0 });
    expect(st.json.percent).toBe(0);
  });

  it("draft_get refuses an id that is not a draft", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    await callTool(erste.id, "draft_promote", {
      draft_id: draft.json.draft_id,
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
    });
    const got = await callTool(erste.id, "draft_get", {
      draft_id: draft.json.draft_id,
    });
    expect(got.isError).toBe(true);
  });
});

describe("draft_promote", () => {
  it("keeps the number and gives the row a cell", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      headline: "Promote me",
    });
    const res = await callTool(erste.id, "draft_promote", {
      draft_id: draft.json.draft_id,
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
    });
    expect(res.isError).toBe(false);
    expect(res.json.message).toMatchObject({
      id: draft.json.draft_id, // same row, not a copy
      number: draft.json.mc_number,
      audience: "SZK_visitors",
      topic: "SZK_brand",
      status: "PREVIEW",
      headline: "Promote me",
    });
    expect(res.json.message.pmmid).toBeTruthy();
  });

  it("refuses a topic that does not exist yet", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const res = await callTool(erste.id, "draft_promote", {
      draft_id: draft.json.draft_id,
      audience_key: "SZK_visitors",
      topic_key: "not_a_topic",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/create the topic first/);
  });
});

describe("brief_attach / list_briefs", () => {
  it("stores the file id and the slide anchor on the card", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const res = await callTool(erste.id, "brief_attach", {
      link: `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g1`,
      draft_id: draft.json.draft_id,
    });
    expect(res.json).toMatchObject({
      message_id: draft.json.draft_id,
      slides_file_id: DECK,
      slide_id: "g1",
    });
  });

  it("reads one deck out of two spellings of its link", async () => {
    // What the briefs table's unique index used to guarantee. The file id is
    // canonical before it is stored, so two cards land on one deck without a
    // row to dedupe against.
    const a = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const b = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    await callTool(erste.id, "brief_attach", {
      link: `https://docs.google.com/presentation/d/${DECK}/edit#slide=id.g1`,
      draft_id: a.json.draft_id,
    });
    await callTool(erste.id, "brief_attach", {
      link: `https://drive.google.com/file/d/${DECK}/view`,
      draft_id: b.json.draft_id,
    });

    const briefs = await callTool(erste.id, "list_briefs", {});
    expect(briefs.json).toHaveLength(1);
    expect(briefs.json[0]).toMatchObject({
      slides_file_id: DECK,
      open_drafts: 2,
      promoted: 0,
    });
  });

  it("detaches on an empty link, and the deck stops being listed", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    await callTool(erste.id, "brief_attach", {
      link: `https://docs.google.com/presentation/d/${DECK}/edit`,
      draft_id: draft.json.draft_id,
    });
    expect((await callTool(erste.id, "list_briefs", {})).json).toHaveLength(1);

    const cleared = await callTool(erste.id, "brief_attach", {
      link: "",
      draft_id: draft.json.draft_id,
    });
    expect(cleared.json.slides_file_id).toBeNull();
    expect((await callTool(erste.id, "list_briefs", {})).json).toHaveLength(0);
  });

  it("moves a brief's count from open to promoted", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
      brief_link: DECK,
    });
    await callTool(erste.id, "draft_promote", {
      draft_id: draft.json.draft_id,
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
    });
    const briefs = await callTool(erste.id, "list_briefs", {});
    expect(briefs.json[0]).toMatchObject({ open_drafts: 0, promoted: 1 });
  });

  it("refuses a folder link and says what to paste", async () => {
    const res = await callTool(erste.id, "brief_attach", {
      link: "https://drive.google.com/drive/folders/1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/FOLDER link/);
  });
});

describe("draft_archive", () => {
  it("archives the draft and keeps its number retired", async () => {
    const draft = await callTool(erste.id, "generate_test_creative", {
      template: "html",
    });
    const res = await callTool(erste.id, "draft_archive", {
      draft_id: draft.json.draft_id,
    });
    expect(res.isError).toBe(false);
    expect((await callTool(erste.id, "list_drafts", {})).json).toHaveLength(0);

    // The number must not come back into circulation: an archived card can be
    // restored, and a restore that collided with a reused number would be a
    // silent data loss.
    const mc = await callTool(erste.id, "mc_create", {
      audience_key: "SZK_visitors",
      topic_key: "SZK_brand",
      mc_number: draft.json.mc_number,
    });
    expect(mc.isError).toBe(true);
    expect(mc.text).toMatch(/retired/);
  });
});
