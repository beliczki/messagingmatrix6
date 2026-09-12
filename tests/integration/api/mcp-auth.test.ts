import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, clients, mcpTokens, users } from "@/db/schema";
import {
  buildMcpServer,
  resolveBearerClient,
  _resetMcpRateLimitForTests,
} from "@/lib/mcp";
import {
  createTestDb,
  withActiveClientKey,
  type TestDb,
} from "../../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let owner: { id: string };

const FULL_TOKEN = "mcp_full_secret";
const READ_TOKEN = "mcp_read_secret";
const DRAFT_TOKEN = "mcp_draft_secret";

const READ_TOOLS = [
  "list_audiences",
  "list_topics",
  "list_mc",
  "list_assets",
  "list_creatives",
  "list_prodlist",
  "list_report_periods",
  "report_performance",
  "mc_get",
  "get_mc_preview_files",
  "get_media_file",
  "show_mc_previews",
  "list_templates",
  "list_products",
  "matrix_status",
  "get_mc_reporting",
  "list_drafts",
  "list_briefs",
  "draft_get",
  "draft_status",
  "show_draft_previews",
];

beforeEach(async () => {
  h = await createTestDb();
  _resetMcpRateLimitForTests();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  withActiveClientKey("erste");
  [owner] = await db
    .insert(users)
    .values({
      id: "user-owner",
      clientId: erste.id,
      email: "owner@erste.hu",
      password: "x",
      role: "admin",
    })
    .returning();
  await db.insert(mcpTokens).values([
    { clientId: erste.id, userId: owner.id, token: FULL_TOKEN, scope: "full" },
    { clientId: erste.id, userId: owner.id, token: READ_TOKEN, scope: "read" },
    {
      clientId: erste.id,
      userId: owner.id,
      token: DRAFT_TOKEN,
      scope: "draft",
    },
  ]);
});

afterEach(async () => {
  await h.cleanup();
});

function bearerReq(token: string) {
  return new Request("http://localhost:6001/mcp", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("resolveBearerClient (mcp_tokens)", () => {
  it("resolves a full token to owner + scope and stamps last_used_at", async () => {
    const ctx = await resolveBearerClient(bearerReq(FULL_TOKEN));
    expect(ctx).toMatchObject({
      clientId: erste.id,
      userId: owner.id,
      scope: "full",
    });
    expect(ctx!.tokenId).toBeTruthy();

    const [row] = await db
      .select()
      .from(mcpTokens)
      .where(eq(mcpTokens.token, FULL_TOKEN))
      .limit(1);
    expect(row!.lastUsedAt).toBeTruthy();
  });

  it("resolves a read token with scope 'read'", async () => {
    const ctx = await resolveBearerClient(bearerReq(READ_TOKEN));
    expect(ctx).toMatchObject({ userId: owner.id, scope: "read" });
  });

  it("resolves a draft token with scope 'draft'", async () => {
    const ctx = await resolveBearerClient(bearerReq(DRAFT_TOKEN));
    expect(ctx).toMatchObject({ userId: owner.id, scope: "draft" });
  });

  // Pre-existing behaviour, kept deliberately in 6.84.0: the column carries no
  // check constraint, and an unrecognised value has always widened to 'full'.
  // Documented here so that narrowing it is a decision, not an accident.
  it("reads an unknown stored scope as 'full'", async () => {
    await db
      .update(mcpTokens)
      .set({ scope: "wat" })
      .where(eq(mcpTokens.token, READ_TOKEN));
    const ctx = await resolveBearerClient(bearerReq(READ_TOKEN));
    expect(ctx).toMatchObject({ scope: "full" });
  });

  it("accepts the ?secret= query-param fallback", async () => {
    const ctx = await resolveBearerClient(
      new Request(`http://localhost:6001/mcp?secret=${FULL_TOKEN}`),
    );
    expect(ctx).toMatchObject({ clientId: erste.id, scope: "full" });
  });

  it("rejects unknown tokens", async () => {
    expect(await resolveBearerClient(bearerReq("mcp_nope"))).toBeNull();
  });

  it("rejects revoked tokens", async () => {
    await db
      .update(mcpTokens)
      .set({ archivedAt: "2026-07-15 00:00:00" })
      .where(eq(mcpTokens.token, FULL_TOKEN));
    expect(await resolveBearerClient(bearerReq(FULL_TOKEN))).toBeNull();
  });

  it("rejects tokens whose owner is archived", async () => {
    await db
      .update(users)
      .set({ archivedAt: "2026-07-15 00:00:00" })
      .where(eq(users.id, owner.id));
    expect(await resolveBearerClient(bearerReq(FULL_TOKEN))).toBeNull();
  });

  it("rejects a valid token of a non-active client (deploy pin)", async () => {
    const [telekom] = await db
      .insert(clients)
      .values({ key: "telekom", name: "Telekom" })
      .returning();
    await db.insert(users).values({
      id: "user-telekom",
      clientId: telekom.id,
      email: "user@telekom.hu",
      password: "x",
      role: "admin",
    });
    await db.insert(mcpTokens).values({
      clientId: telekom.id,
      userId: "user-telekom",
      token: "mcp_telekom_secret",
      scope: "full",
    });
    // Active client is still erste.
    expect(
      await resolveBearerClient(bearerReq("mcp_telekom_secret")),
    ).toBeNull();
  });
});

describe("buildMcpServer scope gating", () => {
  function toolNames(scope: "full" | "draft" | "read"): string[] {
    const server = buildMcpServer({
      clientId: erste.id,
      userId: owner.id,
      scope,
    });
    const registry = (server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;
    return Object.keys(registry);
  }

  it("read scope registers exactly the read/meta tools", () => {
    const names = toolNames("read");
    expect(names.sort()).toEqual([...READ_TOOLS].sort());
    for (const writeTool of [
      "audience_create",
      "topic_create",
      "mc_create",
      "preview_generate",
      "asset_upload",
      "creative_upload",
      "mc_create_batch",
      "generate_test_creative",
      "draft_archive",
      "draft_promote",
    ]) {
      expect(names).not.toContain(writeTool);
    }
  });

  it("draft scope reads everything but writes only inside the draft space", () => {
    const names = toolNames("draft");
    // Every read tool a read token has, it still has.
    for (const readTool of READ_TOOLS) {
      expect(names).toContain(readTool);
    }
    for (const draftWrite of [
      "generate_test_creative",
      "draft_update",
      "brief_attach",
      "draft_archive",
      "asset_upload",
    ]) {
      expect(names).toContain(draftWrite);
    }
    // draft_promote hands the row a cell, which leaves the draft space.
    expect(names).not.toContain("draft_promote");
    for (const matrixWrite of [
      "audience_create",
      "topic_create",
      "mc_create",
      "mc_update",
      "mc_remove",
      "preview_generate",
      "creative_upload",
      "creative_promote",
      "prodlist_upsert",
      "mc_create_batch",
      "mc_copy_batch",
      "mc_move_batch",
    ]) {
      expect(names).not.toContain(matrixWrite);
    }
  });

  it("full scope registers the write tools too", () => {
    const names = toolNames("full");
    for (const t of [
      ...READ_TOOLS,
      "audience_create",
      "mc_update_batch",
      "asset_upload",
      "preview_generate",
      "generate_test_creative",
      "draft_archive",
      "draft_promote",
    ]) {
      expect(names).toContain(t);
    }
  });
});

describe("audit attribution", () => {
  it("attributes MCP writes to the token owner's user id", async () => {
    const server = buildMcpServer({
      clientId: erste.id,
      userId: owner.id,
      scope: "full",
    });
    const registry = (server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>) => Promise<unknown> }
      >;
    })._registeredTools;
    await registry.audience_create!.handler({ name: "MCP made me" });

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityType, "audiences"))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(entry!.userId).toBe(owner.id);
    expect(entry!.action).toBe("create");
  });
});
