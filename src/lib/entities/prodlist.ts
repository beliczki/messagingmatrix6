import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { prodlistRows, nowUtc, type ProdlistRow } from "@/db/schema";

const WRITABLE_FIELDS = [
  "productionUnitId",
  "channel",
  "campaign",
  "format",
  "requiredAsset",
  "flightStart",
  "flightEnd",
  "sourceRef",
  "familyKey",
  "mcNumber",
  "mcVariant",
] as const;
type WritableField = (typeof WRITABLE_FIELDS)[number];

export type ProdlistRowInput = Partial<Pick<ProdlistRow, WritableField>>;

// An upsert row must carry its stable source key; the rest is writable.
export type ProdlistUpsertRow = ProdlistRowInput & { deliverableId: string };

export function pickWritable(input: unknown): ProdlistRowInput {
  if (typeof input !== "object" || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of WRITABLE_FIELDS) {
    if (f in src) out[f] = src[f];
  }
  return out as ProdlistRowInput;
}

export async function listProdlistRows(
  clientId: number,
  opts: { includeArchived?: boolean; channel?: string } = {},
): Promise<ProdlistRow[]> {
  const clauses = [eq(prodlistRows.clientId, clientId)];
  if (!opts.includeArchived) clauses.push(isNull(prodlistRows.archivedAt));
  if (opts.channel) clauses.push(eq(prodlistRows.channel, opts.channel));
  return db
    .select()
    .from(prodlistRows)
    .where(and(...clauses))
    .orderBy(prodlistRows.id);
}

export async function getProdlistRow(
  clientId: number,
  id: number,
): Promise<ProdlistRow | null> {
  const rows = await db
    .select()
    .from(prodlistRows)
    .where(and(eq(prodlistRows.clientId, clientId), eq(prodlistRows.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

// Distinct non-null channels for this client — the source of the nonDCO
// channel-audience set (Slice 1 seed reads this).
export async function listDistinctChannels(
  clientId: number,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ channel: prodlistRows.channel })
    .from(prodlistRows)
    .where(
      and(
        eq(prodlistRows.clientId, clientId),
        isNull(prodlistRows.archivedAt),
        isNotNull(prodlistRows.channel),
      ),
    )
    .orderBy(prodlistRows.channel);
  return rows.map((r) => r.channel).filter((c): c is string => c != null);
}

// Idempotent batch upsert keyed on (clientId, deliverableId). Existing rows are
// updated in place (version bumped); new rows inserted. Atomic single statement.
export async function upsertProdlistRows(
  clientId: number,
  rows: ProdlistUpsertRow[],
): Promise<ProdlistRow[]> {
  if (rows.length === 0) return [];
  const values = rows.map((r) => ({
    ...pickWritable(r),
    deliverableId: r.deliverableId,
    clientId,
  }));
  return db
    .insert(prodlistRows)
    .values(values)
    .onConflictDoUpdate({
      target: [prodlistRows.clientId, prodlistRows.deliverableId],
      set: {
        productionUnitId: sql`excluded.production_unit_id`,
        channel: sql`excluded.channel`,
        campaign: sql`excluded.campaign`,
        format: sql`excluded.format`,
        requiredAsset: sql`excluded.required_asset`,
        flightStart: sql`excluded.flight_start`,
        flightEnd: sql`excluded.flight_end`,
        sourceRef: sql`excluded.source_ref`,
        familyKey: sql`excluded.family_key`,
        mcNumber: sql`excluded.mc_number`,
        mcVariant: sql`excluded.mc_variant`,
        version: sql`${prodlistRows.version} + 1`,
        updatedAt: nowUtc,
      },
    })
    .returning();
}

export async function updateProdlistRow(
  clientId: number,
  id: number,
  expectedVersion: number,
  input: ProdlistRowInput,
): Promise<
  { ok: true; row: ProdlistRow } | { ok: false; current: ProdlistRow | null }
> {
  const current = await getProdlistRow(clientId, id);
  if (!current) return { ok: false, current: null };
  if (current.version !== expectedVersion) return { ok: false, current };
  const [updated] = await db
    .update(prodlistRows)
    .set({
      ...pickWritable(input),
      version: sql`${prodlistRows.version} + 1`,
      updatedAt: nowUtc,
    })
    .where(and(eq(prodlistRows.clientId, clientId), eq(prodlistRows.id, id)))
    .returning();
  return { ok: true, row: updated };
}
