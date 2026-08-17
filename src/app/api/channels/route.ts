import { NextResponse } from "next/server";
import { withSession, withAdmin, denyDemo } from "@/lib/scoped";
import { writeAudit } from "@/lib/audit";
import { createChannel, listChannels } from "@/lib/entities/channels";

export const GET = withSession(async ({ req, claims }) => {
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const rows = await listChannels(claims.cid, { includeArchived });
  return NextResponse.json({ channels: rows });
});

export const POST = withAdmin(async ({ req, claims }) => {
  const denial = denyDemo(claims);
  if (denial) return denial;
  const body = (await req.json().catch(() => null)) as {
    key?: unknown;
    code?: unknown;
    label?: unknown;
  } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!key || !code || !label) {
    return NextResponse.json(
      { error: "key, code and label are required" },
      { status: 400 },
    );
  }
  const row = await createChannel(claims.cid, { key, code, label });
  await writeAudit({
    clientId: claims.cid,
    userId: claims.sub,
    entityType: "channels",
    entityId: row.id,
    action: "create",
    after: row,
  });
  return NextResponse.json({ channel: row }, { status: 201 });
});
