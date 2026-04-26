import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { activeClientId } from "@/lib/active-client";
import { verifySession, type JwtClaims } from "@/lib/auth";

export const AUTH_COOKIE = "auth_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 5; // 5 days

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(AUTH_COOKIE);
}

function readBearer(req: NextRequest): string | null {
  const a = req.headers.get("authorization");
  if (!a) return null;
  const m = a.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Returns claims if a valid session is present AND the JWT's client_id matches
// this deploy's active client. Otherwise returns null. Spec §17.6.
export async function readSession(
  req: NextRequest,
): Promise<JwtClaims | null> {
  const fromHeader = readBearer(req);
  const fromCookie = req.cookies.get(AUTH_COOKIE)?.value;
  const token = fromHeader ?? fromCookie ?? null;
  if (!token) return null;
  let claims: JwtClaims;
  try {
    claims = await verifySession(token);
  } catch {
    return null;
  }
  if (claims.cid !== activeClientId()) {
    return null; // foreign client → defense-in-depth, treat as unauthenticated
  }
  return claims;
}

// Helper for API routes: enforce auth + return 401/403 responses uniformly.
export async function requireSession(
  req: NextRequest,
): Promise<JwtClaims | NextResponse> {
  const claims = await readSession(req);
  if (!claims) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  return claims;
}

export async function requireAdmin(
  req: NextRequest,
): Promise<JwtClaims | NextResponse> {
  const claims = await readSession(req);
  if (!claims) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (claims.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return claims;
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
