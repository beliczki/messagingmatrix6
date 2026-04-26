import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import type { JwtClaims } from "@/lib/auth";

// Wraps an API route handler with auth + active-client assertions.
// Spec §17.6 — every API route asserts JWT.client_id === active_client_id.
// readSession() already enforces that match, so this is mainly for ergonomics.
export type ScopedHandler<T> = (
  ctx: {
    req: NextRequest;
    claims: JwtClaims;
    params: T;
  },
) => Promise<NextResponse> | NextResponse;

export function withSession<T = Record<string, never>>(
  handler: ScopedHandler<T>,
): (req: NextRequest, ctx: { params?: Promise<T> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const claims = await readSession(req);
    if (!claims) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const params = (await ctx.params) ?? ({} as T);
    return handler({ req, claims, params });
  };
}

export function withAdmin<T = Record<string, never>>(
  handler: ScopedHandler<T>,
): (req: NextRequest, ctx: { params?: Promise<T> }) => Promise<NextResponse> {
  return async (req, ctx) => {
    const claims = await readSession(req);
    if (!claims) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (claims.role !== "admin") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const params = (await ctx.params) ?? ({} as T);
    return handler({ req, claims, params });
  };
}

// Demo users can read but not write. Spec §2.
export function denyDemo(claims: JwtClaims): NextResponse | null {
  if (claims.role === "demo") {
    return NextResponse.json(
      { error: "forbidden", reason: "demo users are read-only" },
      { status: 403 },
    );
  }
  return null;
}
