import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, config } from "@/db/schema";
import { withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { defaultConfigSeed } from "@/db/defaults";

const KEY_RE = /^[a-z][a-z0-9_-]{0,30}$/;

export const GET = withAdmin(async () => {
  const rows = await db.select().from(clients);
  return NextResponse.json({ clients: rows });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { key?: unknown; name?: unknown; copyFromKey?: unknown }
    | null;

  if (!body || typeof body.key !== "string" || typeof body.name !== "string") {
    return NextResponse.json(
      { error: "key and name required" },
      { status: 400 },
    );
  }
  const key = body.key.trim().toLowerCase();
  const name = body.name.trim();
  if (!KEY_RE.test(key)) {
    return NextResponse.json(
      {
        error:
          "key must start with a lowercase letter and contain only a-z, 0-9, _ or - (max 31 chars)",
      },
      { status: 400 },
    );
  }
  if (name.length === 0) {
    return NextResponse.json(
      { error: "name must not be empty" },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(clients)
    .where(eq(clients.key, key))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: `client with key "${key}" already exists` },
      { status: 409 },
    );
  }

  const [inserted] = await db.insert(clients).values({ key, name }).returning();

  if (typeof body.copyFromKey === "string" && body.copyFromKey.length > 0) {
    const [source] = await db
      .select()
      .from(clients)
      .where(eq(clients.key, body.copyFromKey))
      .limit(1);
    if (!source) {
      return NextResponse.json(
        { error: `source client "${body.copyFromKey}" not found` },
        { status: 400 },
      );
    }
    const sourceConfig = await db
      .select()
      .from(config)
      .where(eq(config.clientId, source.id));
    if (sourceConfig.length > 0) {
      await db.insert(config).values(
        sourceConfig.map((r) => ({
          clientId: inserted.id,
          key: r.key,
          value: r.value,
          category: r.category,
          description: r.description,
        })),
      );
    }
  } else {
    const rows = defaultConfigSeed().map((r) => ({
      clientId: inserted.id,
      key: r.key,
      category: r.category,
      value: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
    }));
    await db.insert(config).values(rows);
  }

  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "clients",
    entityId: inserted.id,
    action: "create",
    after: inserted,
  });

  return NextResponse.json({ client: inserted }, { status: 201 });
});
