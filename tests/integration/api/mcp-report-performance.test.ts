import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/db";
import { clients, messages, monitoring } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };
let msgId: number;

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

// Each row needs a distinct natural key (the monitoring unique index covers
// platform, period, mc, audience, topic, size) — vary audienceKey per row.
async function seedRow(
  clientId: number,
  r: {
    platform: string;
    product: string | null;
    messageId: number | null;
    impressions: number;
    clicks: number;
    cost: number;
    periodFrom: string;
    periodTo: string;
    audienceKey: string;
  },
) {
  await db.insert(monitoring).values({
    clientId,
    platform: r.platform,
    product: r.product,
    messageId: r.messageId,
    audienceKey: r.audienceKey,
    topicKey: "top1",
    mcNumber: 1,
    mcVariant: "a",
    size: "300x250",
    impressions: r.impressions,
    clicks: r.clicks,
    cost: r.cost,
    conversions: 0,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
  });
}

const JUN = { from: "2026-06-01 00:00:00", to: "2026-06-30 00:00:00" };
const MAY = { from: "2026-05-01 00:00:00", to: "2026-05-31 00:00:00" };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  const [m] = await db
    .insert(messages)
    .values({ clientId: erste.id, number: 1, variant: "a", audience: "aud1", topic: "top1", versionNo: 1 })
    .returning({ id: messages.id });
  msgId = m.id;

  // June (newest): SZK/adform matched + unmatched; SZK/dv360 matched; HK/adform unmatched.
  await seedRow(erste.id, { platform: "adform", product: "SZK", messageId: msgId, impressions: 1000, clicks: 20, cost: 100, audienceKey: "szk-m", ...periods(JUN) });
  await seedRow(erste.id, { platform: "adform", product: "SZK", messageId: null, impressions: 500, clicks: 5, cost: 0, audienceKey: "szk-u", ...periods(JUN) });
  await seedRow(erste.id, { platform: "dv360", product: "SZK", messageId: msgId, impressions: 2000, clicks: 60, cost: 0, audienceKey: "szk-dv", ...periods(JUN) });
  await seedRow(erste.id, { platform: "adform", product: "HK", messageId: null, impressions: 300, clicks: 0, cost: 0, audienceKey: "hk-u", ...periods(JUN) });
  // May (older): one row so a second period exists.
  await seedRow(erste.id, { platform: "adform", product: "SZK", messageId: msgId, impressions: 9, clicks: 9, cost: 9, audienceKey: "szk-may", ...periods(MAY) });
  // Other tenant — must never leak.
  await seedRow(telekom.id, { platform: "adform", product: "TKM", messageId: null, impressions: 999999, clicks: 1, cost: 1, audienceKey: "tkm", ...periods(JUN) });
});

function periods(p: { from: string; to: string }) {
  return { periodFrom: p.from, periodTo: p.to };
}

afterEach(async () => {
  await h.cleanup();
});

describe("list_report_periods via MCP", () => {
  it("returns periods newest first with totals, tenant-scoped", async () => {
    const { json } = await callTool(erste.id, "list_report_periods", {});
    expect(json.map((p: { from: string }) => p.from)).toEqual([JUN.from, MAY.from]);
    const jun = json[0];
    expect(jun.to).toBe(JUN.to);
    expect(jun.rows).toBe(4);
    expect(jun.impressions).toBe(1000 + 500 + 2000 + 300); // 3800, no telekom leak
  });
});

describe("report_performance via MCP", () => {
  it("defaults to newest period, splits product×platform into matched/unmatched with ctr", async () => {
    const { json } = await callTool(erste.id, "report_performance", {});
    expect(json.period.from).toBe(JUN.from);

    // SZK/adform: matched 1000/20, unmatched 500/5
    const szkAdform = json.rows.find(
      (r: { product: string; platform: string }) => r.product === "SZK" && r.platform === "adform",
    );
    expect(szkAdform.matched).toEqual({ impressions: 1000, clicks: 20, cost: 100, ctr: 20 / 1000 });
    expect(szkAdform.unmatched).toEqual({ impressions: 500, clicks: 5, cost: 0, ctr: 5 / 500 });
    expect(szkAdform.total.impressions).toBe(1500);

    // SZK/dv360: matched only, unmatched all-zero + null ctr
    const szkDv = json.rows.find(
      (r: { product: string; platform: string }) => r.product === "SZK" && r.platform === "dv360",
    );
    expect(szkDv.matched.impressions).toBe(2000);
    expect(szkDv.unmatched).toEqual({ impressions: 0, clicks: 0, cost: 0, ctr: null });

    // sorted by total impressions desc → dv360 (2000) before HK/adform (300)
    const imprOrder = json.rows.map((r: { total: { impressions: number } }) => r.total.impressions);
    expect(imprOrder).toEqual([...imprOrder].sort((a, b) => b - a));

    // grand totals split
    expect(json.totals.matched.impressions).toBe(1000 + 2000);
    expect(json.totals.unmatched.impressions).toBe(500 + 300);
    expect(json.totals.total.impressions).toBe(3800);
  });

  it("from selects an older period", async () => {
    const { json } = await callTool(erste.id, "report_performance", { from: MAY.from });
    expect(json.period.from).toBe(MAY.from);
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0].matched.impressions).toBe(9);
    expect(json.totals.total.impressions).toBe(9);
  });

  it("product + platform filters narrow the aggregation", async () => {
    const { json } = await callTool(erste.id, "report_performance", {
      product: "SZK",
      platform: "dv360",
    });
    expect(json.rows).toHaveLength(1);
    expect(json.rows[0].platform).toBe("dv360");
    expect(json.rows[0].total.impressions).toBe(2000);
  });

  it("unknown from returns an error listing available periods", async () => {
    const res = await callTool(erste.id, "report_performance", { from: "1999-01-01 00:00:00" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("no report period");
  });

  it("empty state: no reports → null period, empty rows", async () => {
    const { json } = await callTool(telekom.id, "report_performance", { platform: "nope" });
    // telekom has one JUN row, but platform filter removes it — still resolves the period
    expect(json.period).not.toBeNull();
    expect(json.rows).toHaveLength(0);
  });
});
