import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { activeClientId } from "@/lib/active-client";

const JWT_ALG = "HS256";
const JWT_EXP = "5d";

function getSecret(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "JWT_SECRET is not set or is too short (need at least 16 chars). " +
        "Generate with: openssl rand -hex 32",
    );
  }
  return new TextEncoder().encode(s);
}

export type JwtClaims = {
  sub: string; // user.id
  cid: number; // client_id
  role: string;
  email: string;
};

export async function signSession(user: User): Promise<string> {
  return new SignJWT({
    cid: user.clientId,
    role: user.role,
    email: user.email,
  })
    .setProtectedHeader({ alg: JWT_ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(JWT_EXP)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: [JWT_ALG],
  });
  if (typeof payload.sub !== "string") throw new Error("missing sub");
  if (typeof payload.cid !== "number") throw new Error("missing cid");
  if (typeof payload.role !== "string") throw new Error("missing role");
  if (typeof payload.email !== "string") throw new Error("missing email");
  return {
    sub: payload.sub,
    cid: payload.cid,
    role: payload.role,
    email: payload.email,
  };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Authenticate (active_client_id, email, password). Returns user or null.
// Spec §17.5/§17.7 — login is always against the active client.
export async function authenticate(
  email: string,
  password: string,
): Promise<User | null> {
  const cid = await activeClientId();
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.clientId, cid), eq(users.email, email)))
    .limit(1);
  if (!user) return null;
  const ok = await verifyPassword(password, user.password);
  return ok ? user : null;
}
