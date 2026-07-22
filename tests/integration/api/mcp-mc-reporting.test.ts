import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, messages, monitoring } from "@/db/schema";
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
  const server = buildMcpServer({ clientId, userId: "u", scope: "full" });
  const registry = (server as unknown as {
    _registeredTools: Record<string, { handler: Handler }>;
  })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`tool ${toolName} not registered`);
  return tool.handler;
}

async function callTool(clientId: number, toolName: string, args: Record<string, unknown>) {
  const res = await getHandler(clientId, toolName)(args);
  const text = res.content[0]?.text ?? "";
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

const P = { from: "2026-06-01 00:00:00", to: "2026-06-30 00:00:00" };

async function seedRow(
  clientId: number,
  r: { variant: string; size: string; audienceKey: string; pmmid: string; impressions: number; clicks: number; cost?: number },
) {
  await db.insert(monitoring).values({
    clientId,
    platform: "adform",
    product: "HK",
    pmmid: r.pmmid,
    audienceKey: r.audienceKey,
    topicKey: "top1",
    mcNumber: 244,
    mcVariant: r.variant,
    size: r.size,
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost ?? 0,
    conversions: 0,
    periodFrom: P.from,
    periodTo: P.to,
  });
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  // MC244 b in two audiences × two sizes; MC244 c in one audience.
  await seedRow(erste.id, { variant: "b", size: "300x250", audienceKey: "HK_wlfin", pmmid: "PM-b-fin-l1", impressions: 1000, clicks: 20, cost: 100 });
  await seedRow(erste.id, { variant: "b", size: "970x250", audienceKey: "HK_wlfin", pmmid: "PM-b-fin-l1", impressions: 400, clicks: 4 });
  await seedRow(erste.id, { variant: "b", size: "300x250", audienceKey: "HK_wlhr", pmmid: "PM-b-hr-l2", impressions: 600, clicks: 6, cost: 50 });
  await seedRow(erste.id, { variant: "c", size: "300x250", audienceKey: "HK_wlfin", pmmid: "PM-c-fin-l3", impressions: 900, clicks: 9 });
  // message with a clean PMMID (no lineitem suffix) → resolves to 244/b
  await db.insert(messages).values({ clientId: erste.id, number: 244, variant: "b", audience: "HK_wlfin", topic: "top1", versionNo: 1, pmmid: "PMM-244b" });
  // other tenant
  await seedRow(telekom.id, { variant: "b", size: "300x250", audienceKey: "X", pmmid: "TKM", impressions: 999999, clicks: 1 });
});

afterEach(async () => {
  await h.cleanup();
});

describe("get_mc_reporting via MCP (monitoring-backed)", () => {
  it("mc_number + variant: totals, by_size, by_audience summed across cells", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_number: 244, variant: "b" });
    expect(json.mc).toEqual({ number: 244, variant: "b" });
    expect(json.totals).toEqual({ impressions: 2000, clicks: 30, cost: 150, conversions: 0, ctr: 30 / 2000 });
    // by_size: 300x250 = 1000+600=1600; 970x250 = 400
    const s300 = json.by_size.find((s: { size: string }) => s.size === "300x250");
    expect(s300.impressions).toBe(1600);
    expect(json.by_size.find((s: { size: string }) => s.size === "970x250").impressions).toBe(400);
    // by_audience: HK_wlfin = 1000+400=1400; HK_wlhr = 600
    const aFin = json.by_audience.find((a: { audience_key: string }) => a.audience_key === "HK_wlfin");
    expect(aFin.impressions).toBe(1400);
    expect(aFin.pmmid).toBe("PM-b-fin-l1");
  });

  it("mc_number without variant aggregates all variants + gives by_variant", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_number: 244 });
    expect(json.totals.impressions).toBe(2000 + 900); // b + c
    expect(json.by_variant.map((v: { variant: string }) => v.variant)).toEqual(["b", "c"]);
    expect(json.by_variant.find((v: { variant: string }) => v.variant === "c").impressions).toBe(900);
  });

  it("mc_label as a message PMMID resolves to its number+variant", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_label: "PMM-244b" });
    expect(json.mc).toEqual({ number: 244, variant: "b" });
    expect(json.totals.impressions).toBe(2000);
  });

  it("mc_label as an exact monitoring PMMID matches that row", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_label: "PM-c-fin-l3" });
    expect(json.totals.impressions).toBe(900);
  });

  it("no match → null mc, empty totals", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_number: 777 });
    expect(json.mc).toBeNull();
    expect(json.totals.impressions).toBe(0);
    expect(json.by_size).toEqual([]);
  });

  it("tenant isolation: telekom rows never leak", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", { mc_number: 244, variant: "b" });
    expect(json.totals.impressions).toBe(2000); // not 999999+
  });

  it("validation: exactly one of mc_label / mc_number", async () => {
    const neither = await callTool(erste.id, "get_mc_reporting", {});
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("exactly one");
    const both = await callTool(erste.id, "get_mc_reporting", { mc_label: "x", mc_number: 1 });
    expect(both.isError).toBe(true);
  });

  it("from accepts a bare ISO date (agents pass 2026-06-01, not the stored string)", async () => {
    const { json } = await callTool(erste.id, "get_mc_reporting", {
      mc_number: 244,
      variant: "b",
      from: "2026-06-01",
    });
    expect(json.totals.impressions).toBe(2000);
  });

  it("unknown from errors with the available periods instead of a silent empty", async () => {
    const res = await callTool(erste.id, "get_mc_reporting", {
      mc_number: 244,
      from: "1999-01-01",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("no report period");
    expect(res.text).toContain(P.from);
  });
});
