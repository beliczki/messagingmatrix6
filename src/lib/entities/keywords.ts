import { and, asc, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { keywords, type Keyword } from "@/db/schema";

// Per-client allowed-values list driving audience/topic dropdown autocomplete.
// No `version` column — Keywords are admin-curated, low-contention. Last write
// wins per row; reorder is one transaction. See tasks/todo.md
// "Settings → Keywords tab" checkpoint.
//
// Pure constants live in `keywords-shared.ts` so client code can import them
// without dragging `db` (and therefore `better-sqlite3` / Node `fs`) into the
// browser bundle. Re-exported here for backward-compat with server callers.
export {
  KEYWORD_FORMS,
  KEYWORD_FIELDS,
  type KeywordForm,
} from "@/lib/keywords-shared";

export class KeywordError extends Error {}

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

export function listKeywords(
  clientId: number,
  opts: {
    form?: string;
    field?: string;
    includeArchived?: boolean;
  } = {},
): Keyword[] {
  const conds = [eq(keywords.clientId, clientId)];
  if (opts.form) conds.push(eq(keywords.form, opts.form));
  if (opts.field) conds.push(eq(keywords.field, opts.field));
  if (!opts.includeArchived) conds.push(isNull(keywords.archivedAt));
  return db
    .select()
    .from(keywords)
    .where(and(...conds))
    .orderBy(asc(keywords.form), asc(keywords.field), asc(keywords.orderIndex), asc(keywords.id))
    .all();
}

export function getKeyword(clientId: number, id: number): Keyword | null {
  return (
    db
      .select()
      .from(keywords)
      .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
      .get() ?? null
  );
}

export function createKeyword(
  clientId: number,
  input: KeywordInput,
): Keyword {
  const form = trimRequired(input.form, "form");
  const field = trimRequired(input.field, "field");
  const value = trimRequired(input.value, "value");
  // If orderIndex not supplied, append: max(orderIndex)+1 within (form, field).
  let orderIndex = input.orderIndex;
  if (orderIndex === undefined) {
    const max = db
      .select({ m: sql<number>`COALESCE(MAX(${keywords.orderIndex}), -1)` })
      .from(keywords)
      .where(
        and(
          eq(keywords.clientId, clientId),
          eq(keywords.form, form),
          eq(keywords.field, field),
        ),
      )
      .get();
    orderIndex = (max?.m ?? -1) + 1;
  }
  try {
    return db
      .insert(keywords)
      .values({ clientId, form, field, value, orderIndex })
      .returning()
      .get();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
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

export function updateKeyword(
  clientId: number,
  id: number,
  input: KeywordUpdate,
): Keyword | null {
  const current = getKeyword(clientId, id);
  if (!current) return null;
  const patch: Record<string, unknown> = {};
  if (input.value !== undefined) {
    patch.value = trimRequired(input.value, "value");
  }
  if (input.orderIndex !== undefined) {
    patch.orderIndex = input.orderIndex;
  }
  if (Object.keys(patch).length === 0) return current;
  patch.updatedAt = sql`CURRENT_TIMESTAMP`;
  try {
    return db
      .update(keywords)
      .set(patch)
      .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
      .returning()
      .get();
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      throw new KeywordError(
        `value "${input.value}" already exists for ${current.form}.${current.field}`,
      );
    }
    throw e;
  }
}

export function archiveKeyword(clientId: number, id: number): Keyword | null {
  const current = getKeyword(clientId, id);
  if (!current) return null;
  return db
    .update(keywords)
    .set({
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
    .returning()
    .get();
}

export function restoreKeyword(clientId: number, id: number): Keyword | null {
  const current = getKeyword(clientId, id);
  if (!current) return null;
  return db
    .update(keywords)
    .set({ archivedAt: null, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(keywords.clientId, clientId), eq(keywords.id, id)))
    .returning()
    .get();
}

// Reset orderIndex for every id in `ids` to its array position, in one
// transaction. Tenant-scoped: ids that don't belong to this client are
// silently ignored (the WHERE clause filters them out, the missing ids stay
// at their previous orderIndex). Caller is responsible for passing the full
// (form, field) cohort if they want a stable final order.
export function reorderKeywords(
  clientId: number,
  form: string,
  field: string,
  ids: number[],
): void {
  if (ids.length === 0) return;
  db.transaction((tx) => {
    ids.forEach((id, i) => {
      tx
        .update(keywords)
        .set({ orderIndex: i, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(keywords.clientId, clientId),
            eq(keywords.form, form),
            eq(keywords.field, field),
            eq(keywords.id, id),
          ),
        )
        .run();
    });
  });
}

// Bulk insert used by the XLSX importer. Skips duplicates silently so a
// re-import on top of an existing wipe-fresh client is idempotent.
export function bulkInsertKeywords(
  clientId: number,
  rows: { form: string; field: string; value: string; orderIndex: number }[],
): number {
  if (rows.length === 0) return 0;
  let inserted = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      try {
        tx
          .insert(keywords)
          .values({
            clientId,
            form: r.form,
            field: r.field,
            value: r.value,
            orderIndex: r.orderIndex,
          })
          .run();
        inserted++;
      } catch (e) {
        if (e instanceof Error && /UNIQUE/i.test(e.message)) continue;
        throw e;
      }
    }
  });
  return inserted;
}

// Convenience: hard-delete every keyword for a client. Used by importer wipe.
export function deleteAllKeywordsForClient(clientId: number): number {
  const res = db.delete(keywords).where(eq(keywords.clientId, clientId)).run();
  return res.changes;
}

// Convenience: hard-delete a set of keywords by id (admin tooling; not exposed
// by the v1 UI which uses archive). Kept for tests + cleanup scripts.
export function hardDeleteKeywords(clientId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  const res = db
    .delete(keywords)
    .where(and(eq(keywords.clientId, clientId), inArray(keywords.id, ids)))
    .run();
  return res.changes;
}
