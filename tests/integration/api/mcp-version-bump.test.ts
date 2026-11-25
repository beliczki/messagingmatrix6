// MCP mc_version_bump: the agent-side way to move an MC's VERSION
// (version_no, PMMID -n_; REBUILD_SPEC §21). `version` in its arguments is the
// save counter (If-Match), as in every write tool; `to` is the version_no.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audiences, clients, config, messages, topics } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { copyMessages, createMessage, getMessage } from "@/lib/entities/messages";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let telekom: { id: number };

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;
type Registered = {
  handler: Handler;
  inputSchema: { safeParse: (v: unknown) => { success: boolean } };
};

function registry(clientId: number, scope: "full" | "draft" | "read" = "full") {
  const server = buildMcpServer({ clientId, userId: "u-agent", scope });
  return (server as unknown as { _registeredTools: Record<string, Registered> })
    ._registeredTools;
}

async function bump(clientId: number, args: Record<string, unknown>) {
  const tool = registry(clientId).mc_version_bump;
  if (!tool) throw new Error("mc_version_bump not registered");
  const res = await tool.handler(args);
  const text = res.content[0]?.text ?? "";
  return { isError: !!res.isError, text, json: res.isError ? null : JSON.parse(text) };
}

const PATTERNS = {
  pmmid: "a_{{Audience_Key}}-t_{{Topic_Key}}-m_{{Number}}-v_{{Variant}}-n_{{Version}}",
  trafficking: { utm_cd26: "{{PMMID}}" },
};

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  [telekom] = await db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning();
  await db.insert(config).values({
    clientId: erste.id,
    key: "patterns",
    category: "patterns",
    value: JSON.stringify(PATTERNS),
  });
  await db.insert(audiences).values([
    { clientId: erste.id, key: "aud1", name: "AUD1", orderIndex: 0 },
    { clientId: erste.id, key: "aud2", name: "AUD2", orderIndex: 1 },
  ]);
  await db.insert(topics).values({ clientId: erste.id, key: "top1", name: "TOP1", orderIndex: 0 });
});

afterEach(async () => {
  await h.cleanup();
});

async function seedCard() {
  const primary = await createMessage(erste.id, { audience: "aud1", topic: "top1" });
  await copyMessages(erste.id, [primary.pmmid!], ["aud2"]);
  const [copy2] = await db.select().from(messages).where(eq(messages.audience, "aud2"));
  return { primary: (await getMessage(erste.id, primary.id))!, copy2 };
}

describe("mc_version_bump", () => {
  it("adds one to this copy's version by default and returns the new PMMID", async () => {
    const { primary, copy2 } = await seedCard();
    const res = await bump(erste.id, {
      mc_label: primary.pmmid,
      version: primary.version,
      scope: "local",
    });
    expect(res.isError).toBe(false);
    const expected = `a_aud1-t_top1-m_${primary.number}-v_a-n_2`;
    expect(res.json.previous_pmmid).toBe(primary.pmmid);
    expect(res.json.message.pmmid).toBe(expected);
    expect(res.json.message.versionNo).toBe(2);
    expect(res.json.message.utmCd26).toBe(expected);
    expect(res.json.changed).toBe(1);
    expect((await getMessage(erste.id, copy2.id))!.versionNo).toBe(1);
  });

  it("sets an explicit version on every audience copy with scope global", async () => {
    const { primary, copy2 } = await seedCard();
    const res = await bump(erste.id, {
      mc_label: primary.pmmid,
      version: primary.version,
      scope: "global",
      to: 4,
    });
    expect(res.isError).toBe(false);
    expect(res.json.changed).toBe(2);
    expect(res.json.siblings).toEqual([
      expect.objectContaining({
        id: copy2.id,
        pmmid: `a_aud2-t_top1-m_${primary.number}-v_a-n_4`,
      }),
    ]);
    expect((await getMessage(erste.id, copy2.id))!.versionNo).toBe(4);
  });

  it("reports a stale save counter as version_conflict and changes nothing", async () => {
    const { primary } = await seedCard();
    const res = await bump(erste.id, {
      mc_label: primary.pmmid,
      version: primary.version + 3,
      scope: "local",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^version_conflict/);
    expect((await getMessage(erste.id, primary.id))!.versionNo).toBe(1);
  });

  it("cannot see another client's card", async () => {
    const { primary } = await seedCard();
    const res = await bump(telekom.id, {
      mc_label: primary.pmmid,
      version: primary.version,
      scope: "local",
    });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not found/);
    expect((await getMessage(erste.id, primary.id))!.versionNo).toBe(1);
  });

  it("refuses a draft", async () => {
    // A draft has no PMMID, so it cannot be addressed by mc_label at all.
    const [draft] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 900, variant: "a", status: "DRAFT", audience: null, topic: null })
      .returning();
    const res = await bump(erste.id, { mc_label: "MC900a", version: draft.version, scope: "local" });
    expect(res.isError).toBe(true);
  });

  it("requires scope, takes no default, and accepts only versions of 1 or more", () => {
    const schema = registry(erste.id).mc_version_bump!.inputSchema;
    expect(schema.safeParse({ mc_label: "x", version: 1 }).success).toBe(false);
    expect(schema.safeParse({ mc_label: "x", version: 1, scope: "all" }).success).toBe(false);
    expect(schema.safeParse({ mc_label: "x", scope: "local" }).success).toBe(false);
    expect(schema.safeParse({ mc_label: "x", version: 1, scope: "local", to: 0 }).success).toBe(false);
    expect(schema.safeParse({ mc_label: "x", version: 1, scope: "local", to: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ mc_label: "x", version: 1, scope: "global", to: 3 }).success).toBe(true);
  });

  it("is a full-scope tool: read and draft tokens do not get it", () => {
    expect(Object.keys(registry(erste.id, "full"))).toContain("mc_version_bump");
    expect(Object.keys(registry(erste.id, "read"))).not.toContain("mc_version_bump");
    expect(Object.keys(registry(erste.id, "draft"))).not.toContain("mc_version_bump");
  });
});
