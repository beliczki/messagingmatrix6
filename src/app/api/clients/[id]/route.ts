import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, nowUtc } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

const ALLOWED_STATUS = ["active", "archived"] as const;

export const PATCH = withAdmin<{ id: string }>(async ({ req, claims, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; status?: unknown }
    | null;
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const patch: Partial<{ name: string; status: string }> = {};
  if (typeof body.name === "string") {
    const n = body.name.trim();
    if (n.length === 0) {
      return NextResponse.json(
        { error: "name must not be empty" },
        { status: 400 },
      );
    }
    patch.name = n;
  }
  if (typeof body.status === "string") {
    if (!ALLOWED_STATUS.includes(body.status as (typeof ALLOWED_STATUS)[number])) {
      return NextResponse.json(
        { error: `status must be one of: ${ALLOWED_STATUS.join(", ")}` },
        { status: 400 },
      );
    }
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "nothing to update — provide name and/or status" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(clients)
    .set({ ...patch, updatedAt: nowUtc })
    .where(eq(clients.id, id))
    .returning();

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "clients",
    entityId: id,
    action: "update",
    before: existing,
    after: updated,
  });

  return NextResponse.json({ client: updated });
});
