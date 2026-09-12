"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Icon } from "@/app/_icons/Icon";

type SchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
  hasDefault: boolean;
  primaryKey: boolean;
  references: { table: string; column: string; onDelete: string } | null;
  onlyInDb: boolean;
};

type SchemaTable = {
  name: string;
  estRows: number;
  indexes: number;
  tenantScoped: boolean;
  inCode: boolean;
  columns: SchemaColumn[];
  referencedBy: { table: string; column: string }[];
  missingInDb: string[];
};

type SchemaResponse = {
  tables: SchemaTable[];
  totals: {
    tables: number;
    columns: number;
    foreignKeys: number;
    tenantScoped: number;
  };
  tablesMissingInDb: string[];
};

// Postgres spells its types in full; the short form is what the schema file and
// every migration use, and it keeps the type column narrow enough to scan.
const SHORT_TYPE: Record<string, string> = {
  "character varying": "varchar",
  "double precision": "float8",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamptz",
  "time without time zone": "time",
  integer: "int",
  bigint: "int8",
  smallint: "int2",
  boolean: "bool",
  numeric: "numeric",
  "character": "char",
};

function shortType(t: string): string {
  return SHORT_TYPE[t] ?? t;
}

/** ~4.2k rather than 4231: the count comes from `reltuples`, a planner
 *  estimate, and a precise-looking number would be a lie. */
function approxRows(n: number): string {
  if (n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * The database as it actually is, read from its own catalogs — tables, columns,
 * keys and the foreign keys between them.
 *
 * Read-only on purpose: this is the reference that Structure is NOT. Structure
 * holds the shapes a tenant can configure; this holds what the deploy's
 * Postgres contains, including any drift from `db/schema.ts`.
 */
export function SchemaTab() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery<SchemaResponse>({
    queryKey: ["schema"],
    queryFn: async () => {
      const r = await fetch("/api/schema", { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const needle = q.trim().toLowerCase();
  const tables = useMemo(() => {
    const all = query.data?.tables ?? [];
    if (!needle) return all;
    return all.filter(
      (t) =>
        t.name.includes(needle) ||
        t.columns.some((c) => c.name.includes(needle)),
    );
  }, [query.data, needle]);

  if (query.isLoading) {
    return (
      <div className="schema-tab flex items-center gap-2 text-sm text-slate-500">
        <Icon name="spinner" className="size-4 animate-spin" />
        Reading the database catalog…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="schema-tab rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {(query.error as Error).message}
      </div>
    );
  }

  const totals = query.data!.totals;
  const drift = query.data!.tablesMissingInDb;

  return (
    <div className="schema-tab max-w-4xl">
      <header className="mb-6">
        <p className="text-sm text-slate-500">
          Read-only. The deploy&rsquo;s own Postgres catalog — not a rendering
          of <code className="font-mono">db/schema.ts</code>, so a column the
          code declares and the database lacks (or the reverse) shows up here.
          Row counts are planner estimates.
        </p>
      </header>

      <section className="schema-tab__totals mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Tables", String(totals.tables)],
          ["Columns", String(totals.columns)],
          ["Foreign keys", String(totals.foreignKeys)],
          ["Tenant-scoped", `${totals.tenantScoped} of ${totals.tables}`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="schema-tab__total rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
              {label}
            </div>
            <div className="mt-0.5 text-xl font-semibold text-slate-900">
              {value}
            </div>
          </div>
        ))}
      </section>

      {drift.length > 0 ? (
        <div className="schema-tab__drift mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Icon name="warning" className="mr-1 inline size-3" />
          Declared in <code className="font-mono">db/schema.ts</code> but not in
          this database: {drift.join(", ")}. A query against them would throw —
          a migration has not been applied here.
        </div>
      ) : null}

      <div className="schema-tab__search mb-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by table or column name…"
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      <ul className="schema-tab__tables space-y-2">
        {tables.map((t) => {
          const isOpen = open === t.name || needle.length > 0;
          return (
            <li
              key={t.name}
              className="schema-table rounded-lg border border-slate-200 bg-white"
            >
              <button
                type="button"
                onClick={() => setOpen(isOpen && !needle ? null : t.name)}
                className="schema-table__head flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                <Icon
                  name={isOpen ? "chevron-down" : "chevron-right"}
                  className="size-3.5 shrink-0 text-slate-400"
                />
                <span className="schema-table__name font-mono text-sm font-medium text-slate-900">
                  {t.name}
                </span>
                {t.tenantScoped ? (
                  <span
                    className="schema-table__scope rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                    title="Has a client_id — rows belong to one tenant"
                  >
                    per-client
                  </span>
                ) : (
                  <span
                    className="schema-table__scope rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
                    title="No client_id — shared across tenants"
                  >
                    shared
                  </span>
                )}
                {!t.inCode ? (
                  <span
                    className="schema-table__orphan rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    title="No table in db/schema.ts declares this — the app never reads it"
                  >
                    not in code
                  </span>
                ) : null}
                <span className="schema-table__meta ml-auto shrink-0 font-mono text-[11px] text-slate-400">
                  {t.columns.length} cols · ~{approxRows(t.estRows)} rows ·{" "}
                  {t.indexes} idx
                </span>
              </button>

              {isOpen ? (
                <div className="schema-table__body border-t border-slate-100 px-3 py-2">
                  <table className="schema-table__columns w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                        <th className="py-1 pr-3 font-medium">Column</th>
                        <th className="py-1 pr-3 font-medium">Type</th>
                        <th className="py-1 pr-3 font-medium">Null</th>
                        <th className="py-1 font-medium">References</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.columns.map((c) => (
                        <tr
                          key={c.name}
                          className="schema-column border-t border-slate-100"
                        >
                          <td className="py-1 pr-3 font-mono text-slate-800">
                            {c.name}
                            {c.primaryKey ? (
                              <span
                                className="schema-column__pk ml-1 rounded bg-slate-900 px-1 py-px text-[9px] font-medium text-white"
                                title="Primary key"
                              >
                                PK
                              </span>
                            ) : null}
                            {c.onlyInDb ? (
                              <span
                                className="schema-column__drift ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-800"
                                title="In the database but not in db/schema.ts"
                              >
                                not in code
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-3 font-mono text-slate-500">
                            {shortType(c.type)}
                            {c.hasDefault ? (
                              <span className="text-slate-400"> ·default</span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-3 text-slate-400">
                            {c.nullable ? "null" : "not null"}
                          </td>
                          <td className="py-1 font-mono text-slate-500">
                            {c.references ? (
                              <>
                                → {c.references.table}.{c.references.column}
                                <span className="text-slate-400">
                                  {" "}
                                  ({c.references.onDelete})
                                </span>
                              </>
                            ) : (
                              ""
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {t.missingInDb.length > 0 ? (
                    <p className="schema-table__missing mt-2 text-[11px] text-amber-800">
                      Declared in code, missing here:{" "}
                      <span className="font-mono">
                        {t.missingInDb.join(", ")}
                      </span>
                    </p>
                  ) : null}

                  {t.referencedBy.length > 0 ? (
                    <p className="schema-table__refs mt-2 text-[11px] text-slate-500">
                      <span className="uppercase tracking-wider text-slate-400">
                        referenced by{" "}
                      </span>
                      {t.referencedBy.map((r, i) => (
                        <span key={`${r.table}.${r.column}`}>
                          {i > 0 ? ", " : ""}
                          <button
                            type="button"
                            onClick={() => setOpen(r.table)}
                            className={clsx(
                              "font-mono hover:underline",
                              "text-slate-600",
                            )}
                          >
                            {r.table}.{r.column}
                          </button>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {tables.length === 0 ? (
        <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No table or column matches “{q}”.
        </div>
      ) : null}
    </div>
  );
}
