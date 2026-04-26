import { NextRequest, NextResponse } from "next/server";
import { authenticate, signSession } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : null;
  const password = typeof body?.password === "string" ? body.password : null;
  if (!email || !password) {
    return NextResponse.json({ error: "missing_credentials" }, { status: 400 });
  }
  const user = await authenticate(email, password);
  if (!user) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const token = await signSession(user);
  await setSessionCookie(token);
  return NextResponse.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      clientId: user.clientId,
    },
  });
}
