import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { db } from "@/db";
import { clients, users } from "@/db/schema";
import { signSession, hashPassword } from "@/lib/auth";
import { activeClientId, getActiveClient } from "@/lib/active-client";
import { createTestDb, withActiveClientKey, type TestDb } from "../../helpers/test-db";

let h: TestDb;

beforeEach(async () => {
  h = await createTestDb();
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";

  // Seed two clients + one user per client.
  const [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  const [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
  await db.insert(users).values({
    id: "u-erste",
    clientId: erste.id,
    email: "e@x.com",
    password: await hashPassword("p"),
    role: "admin",
  });
  await db.insert(users).values({
    id: "u-telekom",
    clientId: telekom.id,
    email: "t@x.com",
    password: await hashPassword("p"),
    role: "admin",
  });
});

afterEach(async () => {
  await h.cleanup();
});

// Spec §17.6 — defense-in-depth: even if a token is signed with the right
// secret, if its cid doesn't match the deploy's active client_id, the session
// must be rejected. This is what stops a stolen Telekom token from being
// usable against the Erste deploy.
describe("readSession rejects foreign client_id", () => {
  it("a JWT with cid pointing at Telekom is rejected on the Erste deploy", async () => {
    withActiveClientKey("erste");
    const erste = await getActiveClient();
    expect(erste.key).toBe("erste");

    // Forge a JWT carrying the foreign Telekom client_id but signed with the
    // real secret (worst-case scenario: token leaked, attacker has the secret
    // hash). This must still be rejected because cid !== active_client_id.
    const telekomId = (
      await db.select().from(clients).where(eq(clients.key, "telekom")).limit(1)
    )[0]!.id;
    const forgedToken = await new SignJWT({ cid: telekomId, role: "admin", email: "t@x.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u-telekom")
      .setIssuedAt()
      .setExpirationTime("5d")
      .sign(new TextEncoder().encode(process.env.JWT_SECRET!));

    const claims = await import("@/lib/session").then((m) =>
      m.readSession(makeReq(forgedToken)),
    );
    expect(claims).toBeNull();
  });

  it("a JWT signed with the right secret AND right cid is accepted", async () => {
    withActiveClientKey("erste");
    const erste = await getActiveClient();
    const u = (
      await db.select().from(users).where(eq(users.id, "u-erste")).limit(1)
    )[0]!;
    const validToken = await signSession(u);

    const claims = await import("@/lib/session").then((m) =>
      m.readSession(makeReq(validToken)),
    );
    expect(claims).not.toBeNull();
    expect(claims!.cid).toBe(erste.id);
    expect(claims!.sub).toBe("u-erste");
  });

  it("a token signed with a different secret is rejected even if cid is right", async () => {
    withActiveClientKey("erste");
    const cid = await activeClientId();
    const wrongToken = await new SignJWT({ cid, role: "admin", email: "x@x.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u-erste")
      .setIssuedAt()
      .setExpirationTime("5d")
      .sign(new TextEncoder().encode("DIFFERENT_SECRET_DIFFERENT_SECRET_X"));

    const claims = await import("@/lib/session").then((m) =>
      m.readSession(makeReq(wrongToken)),
    );
    expect(claims).toBeNull();
  });

  it("a valid JWT for an archived user is rejected (Phase 10a soft-delete)", async () => {
    withActiveClientKey("erste");
    const u = (
      await db.select().from(users).where(eq(users.id, "u-erste")).limit(1)
    )[0]!;
    const validToken = await signSession(u);

    // First confirm it works.
    const before = await import("@/lib/session").then((m) =>
      m.readSession(makeReq(validToken)),
    );
    expect(before).not.toBeNull();

    // Archive the user.
    await db
      .update(users)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(users.id, "u-erste"));

    // Same token, now rejected.
    const after = await import("@/lib/session").then((m) =>
      m.readSession(makeReq(validToken)),
    );
    expect(after).toBeNull();
  });
});

// Minimal NextRequest shim — readSession only touches headers + cookies.
function makeReq(bearer: string): import("next/server").NextRequest {
  return {
    headers: new Headers({ authorization: `Bearer ${bearer}` }),
    cookies: { get: () => undefined },
  } as unknown as import("next/server").NextRequest;
}
