// Server-component auth helper. Reads the cookie set by /api/auth/login.
import { cookies } from "next/headers";
import { verifySession, type JwtClaims } from "@/lib/auth";
import { activeClientId } from "@/lib/active-client";

export const AUTH_COOKIE = "auth_token";

export async function readSessionFromCookies(): Promise<JwtClaims | null> {
  const c = await cookies();
  const token = c.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await verifySession(token);
    if (claims.cid !== (await activeClientId())) return null; // foreign cid → reject
    return claims;
  } catch {
    return null;
  }
}
