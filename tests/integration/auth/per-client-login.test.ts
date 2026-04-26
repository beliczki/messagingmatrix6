import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { authenticate, hashPassword } from "@/lib/auth";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;

beforeEach(async () => {
  h = createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";

  // Seed two clients with the SAME admin email + DIFFERENT passwords.
  const erste = db.insert(clients).values({ key: "erste", name: "Erste" }).returning().get();
  const telekom = db.insert(clients).values({ key: "telekom", name: "Telekom" }).returning().get();
  const sharedEmail = "admin@example.com";
  await db.insert(users).values({
    id: nanoid(),
    clientId: erste.id,
    email: sharedEmail,
    password: await hashPassword("erste-pw"),
    role: "admin",
  });
  await db.insert(users).values({
    id: nanoid(),
    clientId: telekom.id,
    email: sharedEmail,
    password: await hashPassword("telekom-pw"),
    role: "admin",
  });
});

afterEach(() => {
  h.cleanup();
});

describe("authenticate scoped to active client", () => {
  it("on the Erste deploy, the Erste password works and the Telekom password does not", async () => {
    withActiveClientKey("erste");
    expect(await authenticate("admin@example.com", "erste-pw")).not.toBeNull();
    expect(await authenticate("admin@example.com", "telekom-pw")).toBeNull();
  });

  it("on the Telekom deploy, the Telekom password works and the Erste password does not", async () => {
    withActiveClientKey("telekom");
    expect(await authenticate("admin@example.com", "telekom-pw")).not.toBeNull();
    expect(await authenticate("admin@example.com", "erste-pw")).toBeNull();
  });

  it("returns the row scoped to the deploy's client (so JWT carries the right cid)", async () => {
    withActiveClientKey("erste");
    const u = await authenticate("admin@example.com", "erste-pw");
    expect(u).not.toBeNull();
    const erste = db.select().from(clients).where(eqKey("erste")).get();
    expect(u?.clientId).toBe(erste?.id);
  });
});

import { eq } from "drizzle-orm";
function eqKey(k: string) {
  return eq(clients.key, k);
}
