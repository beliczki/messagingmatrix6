import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { db } from "@/db";
import { clients, messages, messagePreviews } from "@/db/schema";
import { buildMcpServer } from "@/lib/mcp";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let msgId: number;

const ORIGIN = "https://erste.messagingmatrix.ai";

// Connect a real MCP client to buildMcpServer over an in-memory transport, so the
// full protocol path runs (outputSchema validation, resource list/read).
async function connect(clientId: number) {
  const server = buildMcpServer({ clientId, userId: "u", scope: "read", origin: ORIGIN });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db.insert(clients).values({ key: "erste", name: "Erste" }).returning();
  const [m] = await db
    .insert(messages)
    .values({
      clientId: erste.id,
      number: 244,
      variant: "d",
      audience: "HK_wlfin",
      topic: "top1",
      versionNo: 1,
      pmmid: "PMM-244d",
      name: "Rózsaszínhaj zene",
    })
    .returning({ id: messages.id });
  msgId = m.id;
  await db.insert(messagePreviews).values([
    { clientId: erste.id, messageId: msgId, size: "300x250", storageKey: "k1", messageVersion: 1 },
    { clientId: erste.id, messageId: msgId, size: "970x250", storageKey: "k2", messageVersion: 1 },
  ]);

  // Same MC number+variant fanned out to a second audience cell (a copy),
  // with its own preview rows at the same sizes — must be deduped, not doubled.
  const [m2] = await db
    .insert(messages)
    .values({ clientId: erste.id, number: 244, variant: "d", audience: "SZK_wlfin", topic: "top1", versionNo: 1, pmmid: "PMM-244d-szk", name: "Rózsaszínhaj zene" })
    .returning({ id: messages.id });
  await db.insert(messagePreviews).values([
    { clientId: erste.id, messageId: m2.id, size: "300x250", storageKey: "k3", messageVersion: 1 },
    { clientId: erste.id, messageId: m2.id, size: "970x250", storageKey: "k4", messageVersion: 1 },
  ]);

  // Distinct variants b and c (different creatives), each with a 300x250 preview.
  for (const [v, key] of [["b", "kb"], ["c", "kc"]] as const) {
    const [mv] = await db
      .insert(messages)
      .values({ clientId: erste.id, number: 244, variant: v, audience: "HK_wlfin", topic: "top1", versionNo: 1, pmmid: `PMM-244${v}`, name: "Rózsaszínhaj zene" })
      .returning({ id: messages.id });
    await db.insert(messagePreviews).values({ clientId: erste.id, messageId: mv.id, size: "300x250", storageKey: key, messageVersion: 1 });
  }
});

afterEach(async () => {
  await h.cleanup();
});

describe("show_mc_previews (Apps SDK widget) via real MCP protocol", () => {
  it("returns validated structuredContent with absolute preview URLs", async () => {
    const client = await connect(erste.id);
    const res = (await client.callTool({
      name: "show_mc_previews",
      arguments: { mc_number: 244, variant: "d", audience_key: "HK_wlfin", sizes: ["all"] },
    })) as {
      structuredContent?: { name: string; previews: { label: string; size: string; url: string }[] };
      content: { type: string; text?: string }[];
    };

    expect(res.structuredContent).toBeTruthy();
    expect(res.structuredContent!.name).toContain("MC244");
    expect(
      res.structuredContent!.previews.every((p) =>
        p.url.startsWith(`${ORIGIN}/api/previews/`),
      ),
    ).toBe(true);
    expect(res.structuredContent!.previews.every((p) => p.label === "MC244d")).toBe(true);
    expect(res.structuredContent!.previews.map((p) => p.size).sort()).toEqual([
      "300x250",
      "970x250",
    ]);
    // text fallback for non-widget clients
    expect(res.content[0]!.text).toContain("preview");
    await client.close();
  });

  it("dedupes same-variant audience copies but keeps distinct variants", async () => {
    const client = await connect(erste.id);
    // variant d only, all sizes → two audience copies collapse to 2 sizes (not 4)
    const dOnly = (await client.callTool({
      name: "show_mc_previews",
      arguments: { mc_number: 244, variant: "d", sizes: ["all"] },
    })) as { structuredContent?: { previews: { label: string; size: string }[] } };
    expect(dOnly.structuredContent!.previews.map((p) => p.size).sort()).toEqual([
      "300x250",
      "970x250",
    ]);
    await client.close();
  });

  it("defaults to 300x250 only when sizes is omitted", async () => {
    const client = await connect(erste.id);
    const res = (await client.callTool({
      name: "show_mc_previews",
      arguments: { mc_number: 244, variant: "d" },
    })) as { structuredContent?: { previews: { size: string }[] } };
    expect(res.structuredContent!.previews.map((p) => p.size)).toEqual(["300x250"]);
    await client.close();
  });

  it("keeps the newest reshot copy of a fan-out variant (by updated_at)", async () => {
    // Same MC number+variant in two audience cells; only one was reshot today.
    const mk = async (aud: string, pmmid: string) => {
      const [m] = await db
        .insert(messages)
        .values({ clientId: erste.id, number: 999, variant: "d", audience: aud, topic: "top1", versionNo: 1, pmmid })
        .returning({ id: messages.id });
      return m.id;
    };
    const oldId = await mk("OLD", "P999-old");
    const newId = await mk("NEW", "P999-new");
    await db.insert(messagePreviews).values([
      { clientId: erste.id, messageId: oldId, size: "300x250", storageKey: "old.png", messageVersion: 1, updatedAt: "2026-07-12 08:24:09" },
      { clientId: erste.id, messageId: newId, size: "300x250", storageKey: "new.png", messageVersion: 1, updatedAt: "2026-07-21 10:06:10" },
    ]);

    const client = await connect(erste.id);
    const res = (await client.callTool({
      name: "show_mc_previews",
      arguments: { mc_number: 999, variant: "d" },
    })) as { structuredContent?: { previews: { size: string; url: string }[] } };
    expect(res.structuredContent!.previews).toHaveLength(1);
    const url = res.structuredContent!.previews[0]!.url;
    expect(url).toContain(encodeURIComponent("2026-07-21 10:06:10"));
    expect(url).not.toContain(encodeURIComponent("2026-07-12 08:24:09"));
    await client.close();
  });

  it("variants + sizes filter shows each variant once at the requested size", async () => {
    const client = await connect(erste.id);
    const res = (await client.callTool({
      name: "show_mc_previews",
      arguments: { mc_number: 244, variants: ["b", "c", "d"], sizes: ["300x250"] },
    })) as { structuredContent?: { previews: { label: string; size: string }[] } };
    const previews = res.structuredContent!.previews;
    expect(previews.map((p) => p.size)).toEqual(["300x250", "300x250", "300x250"]);
    expect(previews.map((p) => p.label)).toEqual(["MC244b", "MC244c", "MC244d"]);
    await client.close();
  });

  it("exposes the widget resource, served as mcp-app HTML with a CSP domain", async () => {
    const client = await connect(erste.id);
    const list = await client.listResources();
    const widget = list.resources.find((r) => r.uri === "ui://widget/mc-previews.html");
    expect(widget).toBeTruthy();

    const read = await client.readResource({ uri: "ui://widget/mc-previews.html" });
    const c = read.contents[0]! as {
      mimeType?: string;
      text?: string;
      _meta?: { ui?: { csp?: { resourceDomains?: string[] } } };
    };
    expect(c.mimeType).toBe("text/html;profile=mcp-app");
    expect(c.text).toContain("openai:set_globals");
    expect(c._meta?.ui?.csp?.resourceDomains).toContain(ORIGIN);
    await client.close();
  });

  it("errors (without crashing on outputSchema) when the query is ambiguous/empty", async () => {
    const client = await connect(erste.id);
    const res = (await client.callTool({
      name: "show_mc_previews",
      arguments: {},
    })) as { isError?: boolean; content: { text?: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("exactly one");
    await client.close();
  });
});
