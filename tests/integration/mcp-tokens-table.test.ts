import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { db } from "@/db";
import { clients, mcpTokens, users } from "@/db/schema";
import { createTestDb, type TestDb } from "../helpers/test-db";

let h: TestDb;
let erste: { id: number };
let owner: { id: string };

beforeEach(async () => {
  h = await createTestDb();
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
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
});

afterEach(async () => {
  await h.cleanup();
});

function baseRow(over: Partial<typeof mcpTokens.$inferInsert> = {}) {
  return {
    clientId: erste.id,
    userId: owner.id,
    token: "mcp_abc123",
    ...over,
  };
}

describe("mcp_tokens table (migration 0002)", () => {
  it("accepts a row and fills defaults (scope=full, timestamps)", async () => {
    await db.insert(mcpTokens).values(baseRow());
    const [row] = await db
      .select()
      .from(mcpTokens)
      .where(eq(mcpTokens.token, "mcp_abc123"))
      .limit(1);
    expect(row).toMatchObject({
      clientId: erste.id,
      userId: owner.id,
      scope: "full",
      label: null,
      lastUsedAt: null,
      archivedAt: null,
    });
    expect(row!.createdAt).toBeTruthy();
    expect(row!.updatedAt).toBeTruthy();
  });

  it("enforces global token uniqueness", async () => {
    await db.insert(mcpTokens).values(baseRow());
    await expect(db.insert(mcpTokens).values(baseRow())).rejects.toThrow();
    await expect(
      db.insert(mcpTokens).values(baseRow({ token: "mcp_other" })),
    ).resolves.toBeDefined();
  });

  it("cascades delete from users and clients", async () => {
    await db.insert(mcpTokens).values(baseRow());
    await db.delete(users).where(eq(users.id, owner.id));
    expect(await db.select().from(mcpTokens)).toHaveLength(0);

    await db.insert(users).values({
      id: "user-owner",
      clientId: erste.id,
      email: "owner@erste.hu",
      password: "x",
      role: "admin",
    });
    await db.insert(mcpTokens).values(baseRow());
    await db.delete(clients).where(eq(clients.id, erste.id));
    expect(await db.select().from(mcpTokens)).toHaveLength(0);
  });
});

describe("migration 0002 backfill (clients.mcp_token → mcp_tokens)", () => {
  function readBackfillStatement(): string {
    const dir = path.resolve(process.cwd(), "db", "migrations");
    const file = readdirSync(dir).find((f) => f.startsWith("0002_"));
    expect(file).toBeTruthy();
    const content = readFileSync(path.join(dir, file!), "utf8");
    const stmt = content
      .split(/-->\s*statement-breakpoint/)
      .map((p) => p.trim())
      .find((p) => p.startsWith('INSERT INTO "mcp_tokens"'));
    expect(stmt).toBeTruthy();
    return stmt!;
  }

  it("copies the token to the earliest admin, falls back to any live user, skips userless clients", async () => {
    const sql = postgres(h.url, { max: 1, onnotice: () => {} });
    try {
      // Recreate the pre-migration column the shipped INSERT reads from.
      await sql.unsafe('ALTER TABLE "clients" ADD COLUMN "mcp_token" text');

      // (a) erste: an earlier non-admin plus a later admin → admin wins.
      await db.insert(users).values({
        id: "user-early-plain",
        clientId: erste.id,
        email: "plain@erste.hu",
        password: "x",
        role: "user",
        createdAt: "2026-01-01 00:00:00",
      });
      await db
        .update(users)
        .set({ createdAt: "2026-02-01 00:00:00" })
        .where(eq(users.id, owner.id));
      await sql.unsafe(
        `UPDATE "clients" SET "mcp_token" = 'mcp_erste_live' WHERE "id" = ${erste.id}`,
      );

      // (b) telekom: only a non-admin user → fallback owner.
      const [telekom] = await db
        .insert(clients)
        .values({ key: "telekom", name: "Telekom" })
        .returning();
      await db.insert(users).values({
        id: "user-telekom",
        clientId: telekom.id,
        email: "user@telekom.hu",
        password: "x",
        role: "user",
      });
      await sql.unsafe(
        `UPDATE "clients" SET "mcp_token" = 'mcp_telekom_live' WHERE "id" = ${telekom.id}`,
      );

      // (c) demo: token but zero users → no row.
      const [demo] = await db
        .insert(clients)
        .values({ key: "demo", name: "Demo" })
        .returning();
      await sql.unsafe(
        `UPDATE "clients" SET "mcp_token" = 'mcp_demo_live' WHERE "id" = ${demo.id}`,
      );

      await sql.unsafe(readBackfillStatement());

      const rows = await db.select().from(mcpTokens);
      expect(rows).toHaveLength(2);

      const ersteRow = rows.find((r) => r.clientId === erste.id)!;
      expect(ersteRow).toMatchObject({
        userId: owner.id, // admin beats the earlier plain user
        token: "mcp_erste_live",
        scope: "full",
        label: "Migrated client token",
      });

      const telekomRow = rows.find((r) => r.clientId === telekom.id)!;
      expect(telekomRow).toMatchObject({
        userId: "user-telekom",
        token: "mcp_telekom_live",
        scope: "full",
      });
    } finally {
      await sql.unsafe('ALTER TABLE "clients" DROP COLUMN IF EXISTS "mcp_token"');
      await sql.end();
    }
  });
});
