import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { withAdmin } from "@/lib/scoped";

// What the DATABASE actually holds, read from its own catalogs — not a
// rendering of db/schema.ts. That is the whole point of the Schema tab: the
// code's view and the database's view can drift (a migration applied by hand, a
// column added in code but never migrated), and only a live read can say so.
// The drizzle side is read too, but purely to report the difference.
//
// Catalog reads only: no tenant rows are touched, and nothing here is
// client-scoped, because the schema belongs to the deploy, not to a tenant.

type ColumnRow = {
  table: string;
  name: string;
  type: string;
  nullable: boolean;
  def: string | null;
  position: number;
};

type FkRow = {
  table: string;
  column: string;
  targetTable: string;
  targetColumn: string;
  onDelete: string;
};

// `reltuples::bigint` comes back as a STRING from postgres-js, like every
// bigint — Number() once, here, rather than in the client.
type TableRow = { table: string; est_rows: string };
type PkRow = { table: string; column: string };
type IndexRow = { table: string; count: number };

/** `confdeltype` is a single char; spell it the way the schema file does. */
const ON_DELETE: Record<string, string> = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

export const GET = withAdmin(async () => {
  const tables = (await db.execute(sql`
    select c.relname as table, c.reltuples::bigint as est_rows
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `)) as unknown as TableRow[];

  const columns = (await db.execute(sql`
    select table_name as table,
           column_name as name,
           data_type as type,
           (is_nullable = 'YES') as nullable,
           column_default as def,
           ordinal_position as position
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position
  `)) as unknown as ColumnRow[];

  const pks = (await db.execute(sql`
    select cl.relname as table, att.attname as column
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join unnest(con.conkey) as k(attnum) on true
      join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
     where con.contype = 'p' and n.nspname = 'public'
  `)) as unknown as PkRow[];

  // Composite keys line up by ORDINALITY, so a two-column FK reports both of
  // its pairs rather than a cross product.
  const fks = (await db.execute(sql`
    select src.relname as table,
           srcatt.attname as column,
           tgt.relname as target_table,
           tgtatt.attname as target_column,
           con.confdeltype as on_delete
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace n on n.oid = src.relnamespace
      join unnest(con.conkey) with ordinality as sk(attnum, ord) on true
      join unnest(con.confkey) with ordinality as tk(attnum, ord) on tk.ord = sk.ord
      join pg_attribute srcatt on srcatt.attrelid = src.oid and srcatt.attnum = sk.attnum
      join pg_attribute tgtatt on tgtatt.attrelid = tgt.oid and tgtatt.attnum = tk.attnum
     where con.contype = 'f' and n.nspname = 'public'
     order by src.relname, srcatt.attname
  `)) as unknown as Array<
    Omit<FkRow, "targetTable" | "targetColumn" | "onDelete"> & {
      target_table: string;
      target_column: string;
      on_delete: string;
    }
  >;

  const indexes = (await db.execute(sql`
    select tablename as table, count(*)::int as count
      from pg_indexes
     where schemaname = 'public'
     group by tablename
  `)) as unknown as IndexRow[];

  // The code's own view, for the drift report only.
  const codeTables = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    codeTables.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }

  const pkByTable = new Map<string, Set<string>>();
  for (const r of pks) {
    const set = pkByTable.get(r.table) ?? new Set<string>();
    set.add(r.column);
    pkByTable.set(r.table, set);
  }

  const fkByTable = new Map<string, FkRow[]>();
  for (const r of fks) {
    const row: FkRow = {
      table: r.table,
      column: r.column,
      targetTable: r.target_table,
      targetColumn: r.target_column,
      onDelete: ON_DELETE[r.on_delete] ?? r.on_delete,
    };
    fkByTable.set(r.table, [...(fkByTable.get(r.table) ?? []), row]);
  }

  const colsByTable = new Map<string, ColumnRow[]>();
  for (const c of columns) {
    colsByTable.set(c.table, [...(colsByTable.get(c.table) ?? []), c]);
  }

  const indexByTable = new Map(indexes.map((i) => [i.table, i.count]));

  const out = tables.map((t) => {
    const cols = colsByTable.get(t.table) ?? [];
    const pk = pkByTable.get(t.table) ?? new Set<string>();
    const outgoing = fkByTable.get(t.table) ?? [];
    const fkCols = new Map(outgoing.map((f) => [f.column, f]));
    const inCode = codeTables.get(t.table);
    return {
      name: t.table,
      estRows: Number(t.est_rows ?? 0),
      indexes: indexByTable.get(t.table) ?? 0,
      // A table with client_id is tenant-scoped; the handful without it are
      // either global (clients, users are scoped, config is not…) or plumbing.
      tenantScoped: cols.some((c) => c.name === "client_id"),
      inCode: inCode !== undefined,
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        hasDefault: c.def !== null,
        primaryKey: pk.has(c.name),
        references: fkCols.get(c.name)
          ? {
              table: fkCols.get(c.name)!.targetTable,
              column: fkCols.get(c.name)!.targetColumn,
              onDelete: fkCols.get(c.name)!.onDelete,
            }
          : null,
        /** In the database but not in db/schema.ts — the code cannot read it. */
        onlyInDb: inCode !== undefined && !inCode.has(c.name),
      })),
      referencedBy: fks
        .filter((f) => f.target_table === t.table)
        .map((f) => ({ table: f.table, column: f.column })),
      /** In db/schema.ts but not in the database — a query on it would throw. */
      missingInDb: inCode
        ? [...inCode].filter((name) => !cols.some((c) => c.name === name))
        : [],
    };
  });

  const dbNames = new Set(tables.map((t) => t.table));
  return NextResponse.json({
    tables: out,
    totals: {
      tables: out.length,
      columns: columns.length,
      foreignKeys: fks.length,
      tenantScoped: out.filter((t) => t.tenantScoped).length,
    },
    /** Declared in db/schema.ts, absent from the database. */
    tablesMissingInDb: [...codeTables.keys()].filter((n) => !dbNames.has(n)),
  });
});
