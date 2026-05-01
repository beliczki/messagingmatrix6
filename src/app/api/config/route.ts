import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { config } from "@/db/schema";
import { withSession, withAdmin } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";

type ConfigRowOut = {
  key: string;
  category: string | null;
  value: unknown;
  description: string | null;
  updatedAt: string;
};

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const GET = withSession(({ req, claims }) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const category = url.searchParams.get("category");

  const rows = (() => {
    if (key) {
      return db
        .select()
        .from(config)
        .where(and(eq(config.clientId, claims.cid), eq(config.key, key)))
        .all();
    }
    if (category) {
      return db
        .select()
        .from(config)
        .where(and(eq(config.clientId, claims.cid), eq(config.category, category)))
        .all();
    }
    return db.select().from(config).where(eq(config.clientId, claims.cid)).all();
  })();

  const out: ConfigRowOut[] = rows.map((r) => ({
    key: r.key,
    category: r.category,
    value: parseValue(r.value),
    description: r.description,
    updatedAt: r.updatedAt,
  }));

  return NextResponse.json({ rows: out });
});

export const PUT = withAdmin(async ({ req, claims }) => {
  const body = (await req.json().catch(() => null)) as
    | { key?: unknown; value?: unknown; category?: unknown }
    | null;
  if (!body || typeof body.key !== "string" || body.key.length === 0) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  const key = body.key;
  const valueStr =
    typeof body.value === "string" ? body.value : JSON.stringify(body.value);
  const category =
    typeof body.category === "string" ? body.category : null;

  const existing = db
    .select()
    .from(config)
    .where(and(eq(config.clientId, claims.cid), eq(config.key, key)))
    .get();

  const beforeValue = existing ? parseValue(existing.value) : null;

  if (existing) {
    db.update(config)
      .set({
        value: valueStr,
        category,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      })
      .where(and(eq(config.clientId, claims.cid), eq(config.key, key)))
      .run();
  } else {
    db.insert(config)
      .values({ clientId: claims.cid, key, value: valueStr, category })
      .run();
  }

  const afterValue = parseValue(valueStr);

  writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "config",
    entityId: key,
    action: existing ? "update" : "create",
    before: beforeValue,
    after: afterValue,
  });

  return NextResponse.json({ ok: true, key, value: afterValue });
});
