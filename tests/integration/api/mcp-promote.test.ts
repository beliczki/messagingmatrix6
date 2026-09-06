import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels, clients, creatives, prodlistRows } from "@/db/schema";
import { buildMcpServer, _resetMcpRateLimitForTests } from "@/lib/mcp";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };

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
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

async function seedChannelAudience(clientId: number, channel: string, order: number) {
  // Channels are their own table now; promotion resolves by channel code.
  const [row] = await db
    .insert(channels)
    .values({
      clientId,
      key: `ch_${channel.toLowerCase()}`,
      code: channel,
      label: channel,
      orderIndex: order,
    })
    .returning();
  return row;
}

async function seedCreative(
  clientId: number,
  fields: Partial<typeof creatives.$inferInsert> & { fileName: string },
) {
  const [row] = await db
    .insert(creatives)
    .values({ clientId, ...fields })
    .returning();
  return row;
}

beforeEach(async () => {
  _resetMcpRateLimitForTests();
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  withActiveClientKey("erste");
});

afterEach(async () => {
  await h.cleanup();
});

const FILE = "ERSTE_SZA_MC289_a_diakszamla_2026Q1_640x360.jpg";

describe("creative_promote via MCP", () => {
  it("explicit channel: creates a template-less image MC + back-links the creative", async () => {
    await seedChannelAudience(erste.id, "DISP", 0);
    const cr = await seedCreative(erste.id, {
      fileName: FILE,
      familyKey: "ERSTE_SZA_MC289_a_diakszamla_2026Q1",
    });

    const res = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
      channel: "DISP",
    });
    expect(res.isError).toBe(false);
    expect(res.json.message.template).toBeNull();
    expect(res.json.message.image1).toBe(FILE);
    expect(res.json.audience.key).toBe("ch_disp");
    expect(res.json.topic.key).toBe("diakszamla");

    // creative is back-linked
    const [linked] = await db
      .select()
      .from(creatives)
      .where(eq(creatives.id, cr.id));
    expect(linked.mcNumber).toBe(res.json.message.number);
    expect(linked.mcVariant).toBe(res.json.message.variant);

    // it surfaces through list_mc as a static MC: template null in the lean
    // projection; image1 present when verbose.
    const lean = await callTool(erste.id, "list_mc", {});
    const leanMc = lean.json.find(
      (m: { id: number }) => m.id === res.json.message.id,
    );
    expect(leanMc).toBeTruthy();
    expect(leanMc.template ?? null).toBeNull();

    const verbose = await callTool(erste.id, "list_mc", { verbose: true });
    const fullMc = verbose.json.find(
      (m: { id: number }) => m.id === res.json.message.id,
    );
    expect(fullMc.image1).toBe(FILE);
  });

  it("refuses an already-matrixed creative", async () => {
    await seedChannelAudience(erste.id, "DISP", 0);
    const cr = await seedCreative(erste.id, { fileName: FILE });

    const first = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
      channel: "DISP",
    });
    expect(first.isError).toBe(false);

    const second = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
      channel: "DISP",
    });
    expect(second.isError).toBe(true);
    expect(second.text).toContain("already matrixed");
  });

  it("matrixizes a filename-numbered creative at the number it names", async () => {
    // mc_number/mc_variant come from the filename at upload — they say what the
    // file IS, not that a card exists for it. Promote used to read them as
    // proof of one and refuse.
    await seedChannelAudience(erste.id, "DISP", 0);
    const cr = await seedCreative(erste.id, {
      fileName: "ERSTE_SZA_MC324_b_DiakszamlaQ3_n2_970x250.png",
      product: "SZA",
      mcNumber: 324,
      mcVariant: "b",
    });

    const res = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
      channel: "DISP",
    });
    expect(res.isError).toBe(false);
    expect(res.json.message.number).toBe(324);
    expect(res.json.message.variant).toBe("b");
    expect(res.json.message.template).toBeNull();

    // Now there IS a card, so a second call is refused — for the right reason.
    const again = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
      channel: "DISP",
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already matrixed");
  });

  it("resolves the channel from a prodlist deliverable match on familyKey", async () => {
    await seedChannelAudience(erste.id, "PRG", 0);
    const familyKey = "ERSTE_SZA_MC289_a_diakszamla_2026Q1";
    await db.insert(prodlistRows).values({
      clientId: erste.id,
      deliverableId: "DEL-1",
      channel: "PRG",
      familyKey,
    });
    const cr = await seedCreative(erste.id, { fileName: FILE, familyKey });

    // no explicit channel → prodlist match picks PRG
    const res = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
    });
    expect(res.isError).toBe(false);
    expect(res.json.audience.key).toBe("ch_prg");
  });

  it("errors when no channel can be determined", async () => {
    const cr = await seedCreative(erste.id, { fileName: FILE });
    const res = await callTool(erste.id, "creative_promote", {
      creative_id: cr.id,
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("no channel");
  });

  it("resolves the creative by file_name", async () => {
    await seedChannelAudience(erste.id, "DISP", 0);
    await seedCreative(erste.id, { fileName: FILE });

    const res = await callTool(erste.id, "creative_promote", {
      file_name: FILE,
      channel: "DISP",
    });
    expect(res.isError).toBe(false);
    expect(res.json.message.image1).toBe(FILE);
  });

  it("requires exactly one of creative_id / file_name", async () => {
    const neither = await callTool(erste.id, "creative_promote", {
      channel: "DISP",
    });
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("exactly one");
  });
});
