import { and, asc, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { keywords, nowUtc, type Keyword } from "@/db/schema";

// Per-client allowed-values list driving audience/topic dropdown autocomplete.
// No `version` column — Keywords are admin-curated, low-contention. Last write
// wins per row; reorder is one transaction. See tasks/todo.md
// "Settings → Keywords tab" checkpoint.
//
// Pure constants live in `keywords-shared.ts` so client code can import them
// without dragging `db` into the browser bundle. Re-exported here for
// backward-compat with server callers.
export {
  KEYWORD_FORMS,
  KEYWORD_FIELDS,
  type KeywordForm,
} from "@/lib/keywords-shared";

export class KeywordError extends Error {}

// Postgres unique-violation detector. postgres-js throws a PostgresError with
// SQLSTATE 23505, which drizzle wraps in a DrizzleQueryError (the constraint
// text lands on `.cause.message`, not `.message`) — so match on the code, which
// is stable across both the raw and wrapped error shapes.
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null)?.code;
  const causeCode = (e as { cause?: { code?: string } } | null)?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

export type KeywordInput = {
  form: string;
  field: string;
  value: string;
  orderIndex?: number;
};

function trimRequired(s: unknown, name: string): string {
  if (typeof s !== "string") throw new KeywordError(`${name} must be a string`);
  const t = s.trim();
  if (!t) throw new KeywordError(`${name} is required`);
  return t;
}

export async function listKeywords(
  clientId: number,
  opts: {
    form?: string;
    field?: string;
    includeArchived?: boolean;
  } = {},
): Promise<Keyword[]> {
  const conds = [eq(keywords.clientId, clientId)];
  if (opts.form) conds.push(eq(keywords.form, opts.form));
  if (opts.field) conds.push(eq(keywords.field, opts.field));
  if (!opts.includeArchived) conds.push(isNull(keywords.archivedAt));
  return db
    .select()
    .from(keywords)
    .where(and(...conds))
    .orderBy(
      asc(keywords.form),
      asc(keywords.field),
      asc(keywords.orderIndex),
      asc(keywords.id),
    );
}

export async function getKeyword(
  clientId: number,
  id: number,
): Promise<Keyword | null> {
  const rows = await db
    .select()
    .from(keywords)
    .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createKeyword(
  clientId: number,
  input: KeywordInput,
): Promise<Keyword> {
  const form = trimRequired(input.form, "form");
  const field = trimRequired(input.field, "field");
  const value = trimRequired(input.value, "value");
  // If orderIndex not supplied, append: max(orderIndex)+1 within (form, field).
  let orderIndex = input.orderIndex;
  if (orderIndex === undefined) {
    const [max] = await db
      .select({ m: sql<number>`COALESCE(MAX(${keywords.orderIndex}), -1)` })
      .from(keywords)
      .where(
        and(
          eq(keywords.clientId, clientId),
          eq(keywords.form, form),
          eq(keywords.field, field),
        ),
      );
    orderIndex = (max?.m ?? -1) + 1;
  }
  try {
    const [row] = await db
      .insert(keywords)
      .values({ clientId, form, field, value, orderIndex })
      .returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new KeywordError(
        `value "${value}" already exists for ${form}.${field}`,
      );
    }
    throw e;
  }
}

export type KeywordUpdate = {
  value?: string;
  orderIndex?: number;
};

export async function updateKeyword(
  clientId: number,
  id: number,
  input: KeywordUpdate,
): Promise<Keyword | null> {
  const current = await getKeyword(clientId, id);
  if (!current) return null;
  const patch: Record<string, unknown> = {};
  if (input.value !== undefined) {
    patch.value = trimRequired(input.value, "value");
  }
  if (input.orderIndex !== undefined) {
    patch.orderIndex = input.orderIndex;
  }
  if (Object.keys(patch).length === 0) return current;
  patch.updatedAt = nowUtc;
  try {
    const [row] = await db
      .update(keywords)
      .set(patch)
      .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
      .returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new KeywordError(
        `value "${input.value}" already exists for ${current.form}.${current.field}`,
      );
    }
    throw e;
  }
}

export async function archiveKeyword(
  clientId: number,
  id: number,
): Promise<Keyword | null> {
  const current = await getKeyword(clientId, id);
  if (!current) return null;
  const [row] = await db
    .update(keywords)
    .set({ archivedAt: nowUtc, updatedAt: nowUtc })
    .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
    .returning();
  return row ?? null;
}

export async function restoreKeyword(
  clientId: number,
  id: number,
): Promise<Keyword | null> {
  const current = await getKeyword(clientId, id);
  if (!current) return null;
  const [row] = await db
    .update(keywords)
    .set({ archivedAt: null, updatedAt: nowUtc })
    .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
    .returning();
  return row ?? null;
}

// Reset orderIndex for every id in `ids` to its array position, in one
// transaction. Tenant-scoped: ids that don't belong to this client are
// silently ignored (the WHERE clause filters them out, the missing ids stay
// at their previous orderIndex). Caller is responsible for passing the full
// (form, field) cohort if they want a stable final order.
export async function reorderKeywords(
  clientId: number,
  form: string,
  field: string,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(keywords)
        .set({ orderIndex: i, updatedAt: nowUtc })
        .where(
          and(
            eq(keywords.clientId, clientId),
            eq(keywords.form, form),
            eq(keywords.field, field),
            eq(keywords.id, ids[i]),
          ),
        );
    }
  });
}

// Bulk insert used by the XLSX importer. Skips duplicates silently so a
// re-import on top of an existing wipe-fresh client is idempotent.
export async function bulkInsertKeywords(
  clientId: number,
  rows: { form: string; field: string; value: string; orderIndex: number }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const r of rows) {
    // Each insert is its own statement so a UNIQUE collision skips just that
    // row (a single failed statement aborts the whole Postgres transaction,
    // so we cannot swallow-and-continue inside one tx as SQLite allowed).
    try {
      await db.insert(keywords).values({
        clientId,
        form: r.form,
        field: r.field,
        value: r.value,
        orderIndex: r.orderIndex,
      });
      inserted++;
    } catch (e) {
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return inserted;
}

// Convenience: hard-delete every keyword for a client. Used by importer wipe.
export async function deleteAllKeywordsForClient(
  clientId: number,
): Promise<number> {
  const res = await db
    .delete(keywords)
    .where(eq(keywords.clientId, clientId))
    .returning({ id: keywords.id });
  return res.length;
}

// Convenience: hard-delete a set of keywords by id (admin tooling; not exposed
// by the v1 UI which uses archive). Kept for tests + cleanup scripts.
export async function hardDeleteKeywords(
  clientId: number,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await db
    .delete(keywords)
    .where(and(eq(keywords.clientId, clientId), inArray(keywords.id, ids)))
    .returning({ id: keywords.id });
  return res.length;
}
