import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { readSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const claims = await readSession(req);
  if (!claims) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const u = db.select().from(users).where(eq(users.id, claims.sub)).get();
  if (!u) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }
  return NextResponse.json({
    user: { id: u.id, email: u.email, role: u.role, clientId: u.clientId },
  });
}
