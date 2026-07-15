import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, auditLog, clients, messages, topics } from "@/db/schema";
import { createMessage } from "@/lib/entities/messages";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

async function seedAudience(clientId: number, key: string) {
  const [row] = await db
    .insert(audiences)
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
      strategy: "Prospecting",
      device: "Mobile",
    })
    .returning();
  return row;
}

async function seedTopic(clientId: number, key: string) {
  const [row] = await db
    .insert(topics)
    .values({
      clientId,
      key,
      name: key.toUpperCase(),
      orderIndex: 0,
      product: "Loans",
    })
    .returning();
  return row;
}

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

describe("mc_copy_batch via MCP", () => {
  it("copies one source into multiple audiences and writes a single bulk_copy audit row", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedAudience(erste.id, "aud3");
    await seedTopic(erste.id, "top1");
    const source = await createMessage(erste.id, {
      audience: "aud1",
      topic: "top1",
      name: "Source",
    });

    const { isError, json } = await callTool(erste.id, "mc_copy_batch", {
      source_mc_labels: [source.pmmid!],
      target_audience_keys: ["aud2", "aud3"],
    });
    expect(isError).toBe(false);
    expect(json.created).toHaveLength(2);

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.clientId, erste.id), eq(auditLog.action, "bulk_copy")),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].entityId).toBe(`bulk:${erste.id}`);
  });

  it("refuses sources from a different client (tenant isolation)", async () => {
    await seedAudience(erste.id, "aud1");
    await seedTopic(erste.id, "top1");
    await seedAudience(telekom.id, "audT");
    await seedTopic(telekom.id, "topT");
    const telekomMsg = await createMessage(telekom.id, {
      audience: "audT",
      topic: "topT",
    });

    const { isError, text } = await callTool(erste.id, "mc_copy_batch", {
      source_mc_labels: [telekomMsg.pmmid!],
      target_audience_keys: ["aud1"],
    });
    expect(isError).toBe(true);
    expect(text).toContain("not found");
  });
});

describe("mc_move_batch via MCP", () => {
  it("moves a batch into one audience and writes a single bulk_move audit row", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const a = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
    const b = await createMessage(erste.id, { audience: "aud1", topic: "top1" });

    const { isError, json } = await callTool(erste.id, "mc_move_batch", {
      moves: [
        { mc_label: a.pmmid!, version: a.version },
        { mc_label: b.pmmid!, version: b.version },
      ],
      target_audience_key: "aud2",
    });
    expect(isError).toBe(false);
    expect(json.updated).toHaveLength(2);
    for (const row of json.updated) expect(row.audience).toBe("aud2");

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.clientId, erste.id), eq(auditLog.action, "bulk_move")),
      );
    expect(auditRows).toHaveLength(1);
  });

  it("surfaces version_conflict and rolls the batch back", async () => {
    await seedAudience(erste.id, "aud1");
    await seedAudience(erste.id, "aud2");
    await seedTopic(erste.id, "top1");
    const m = await createMessage(erste.id, { audience: "aud1", topic: "top1" });

    const { isError, text } = await callTool(erste.id, "mc_move_batch", {
      moves: [{ mc_label: m.pmmid!, version: m.version + 99 }],
      target_audience_key: "aud2",
    });
    expect(isError).toBe(true);
    expect(text).toContain("version_conflict");

    // Row unchanged.
    const [after] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, m.id))
      .limit(1);
    expect(after?.audience).toBe("aud1");
    expect(after?.version).toBe(m.version);

    // No audit row for the failed batch.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.clientId, erste.id), eq(auditLog.action, "bulk_move")),
      );
    expect(auditRows).toHaveLength(0);
  });
});
