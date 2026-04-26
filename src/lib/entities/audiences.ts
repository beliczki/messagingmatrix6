import { and, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { audiences, type Audience } from "@/db/schema";

// Field whitelist for create/update — prevents client_id / id / version /
// timestamps from being injected via request body.
const WRITABLE_FIELDS = [
  "key",
  "name",
  "orderIndex",
  "status",
  "product",
  "strategy",
  "buyingPlatform",
  "dataSource",
  "targetingType",
  "device",
  "tag",
  "comment",
  "campaignName",
  "campaignId",
  "lineitemName",
  "lineitemId",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type AudienceInput = Partial<Pick<Audience, WritableField>>;

export function pickWritable(input: unknown): AudienceInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as AudienceInput;
}

export function listAudiences(clientId: number): Audience[] {
  return db
    .select()
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .orderBy(audiences.orderIndex)
    .all();
}

export function getAudience(clientId: number, id: number): Audience | null {
  return (
    db
      .select()
      .from(audiences)
      .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
      .get() ?? null
  );
}

function nextOrderIndex(clientId: number): number {
  const row = db
    .select({ m: max(audiences.orderIndex) })
    .from(audiences)
    .where(eq(audiences.clientId, clientId))
    .get();
  return (row?.m ?? -1) + 1;
}

export function createAudience(
  clientId: number,
  input: AudienceInput,
): Audience {
  const orderIndex = input.orderIndex ?? nextOrderIndex(clientId);
  const key = input.key ?? `aud${orderIndex + 1}`;
  if (!input.name) {
    throw new BadRequest("name is required");
  }
  return db
    .insert(audiences)
    .values({
      clientId,
      key,
      name: input.name,
      orderIndex,
      status: input.status,
      product: input.product,
      strategy: input.strategy,
      buyingPlatform: input.buyingPlatform,
      dataSource: input.dataSource,
      targetingType: input.targetingType,
      device: input.device,
      tag: input.tag,
      comment: input.comment,
      campaignName: input.campaignName,
      campaignId: input.campaignId,
      lineitemName: input.lineitemName,
      lineitemId: input.lineitemId,
    })
    .returning()
    .get();
}

export function updateAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: AudienceInput,
): { ok: true; row: Audience } | { ok: false; current: Audience | null } {
  const current = getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  const updated = db
    .update(audiences)
    .set({
      ...input,
      version: sql`${audiences.version} + 1`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .returning()
    .get();
  return { ok: true, row: updated };
}

export function deleteAudience(
  clientId: number,
  id: number,
  expectedVersion: number,
): { ok: true; row: Audience } | { ok: false; current: Audience | null } {
  const current = getAudience(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) {
    return { ok: false, current };
  }
  db.delete(audiences)
    .where(and(eq(audiences.clientId, clientId), eq(audiences.id, id)))
    .run();
  return { ok: true, row: current };
}

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}
