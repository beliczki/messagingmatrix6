"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/app/_icons/Icon";
import AppDialog from "../_components/AppDialog";

export type DigestGroup = {
  entityType: string;
  action: string;
  n: number;
  actors: string[];
};

type AuditRow = {
  id: number;
  userId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before: string | null;
  after: string | null;
  createdAt: string;
};

const ACTION_TONE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-800",
  bulk_create: "bg-emerald-100 text-emerald-800",
  update: "bg-blue-100 text-blue-800",
  bulk_update: "bg-blue-100 text-blue-800",
  delete: "bg-rose-100 text-rose-800",
  bulk_delete: "bg-rose-100 text-rose-800",
  archive: "bg-amber-100 text-amber-800",
  bulk_archive: "bg-amber-100 text-amber-800",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={`status-badge activity-digest__action rounded px-1.5 py-0.5 text-xs font-medium ${
        ACTION_TONE[action] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {action}
    </span>
  );
}

/** The window's writes, grouped the way the digest counts them — and, for an
 *  admin, the rows behind any one of those counts.
 *
 *  Aggregation is what makes the panel readable (a busy day writes thousands of
 *  audit rows), but "28 updates to messages" is also the moment the question
 *  "which 28?" arrives, and until now it had no answer on this page. */
export default function ActivityDigest({
  groups,
  more,
  scope,
  products,
  canDrillDown,
}: {
  groups: DigestGroup[];
  /** How many further entity+action kinds the list does not show. */
  more: number;
  scope: { from: string; to: string; label: string };
  products: string[];
  /** The audit log is admin-only; everyone else sees the counts alone. */
  canDrillDown: boolean;
}) {
  const [open, setOpen] = useState<DigestGroup | null>(null);

  return (
    <>
      <ul className="activity-digest divide-y divide-slate-100 text-sm">
        {groups.map((g) => {
          const row = (
            <>
              <ActionBadge action={g.action} />
              <span className="activity-digest__entity text-slate-700">
                {g.entityType}
              </span>
              <span className="activity-digest__actors truncate text-xs text-slate-400">
                {g.actors.join(", ")}
              </span>
              <span className="activity-digest__count ml-auto font-mono text-sm text-slate-900">
                {g.n}
              </span>
            </>
          );
          return (
            <li key={`${g.entityType}:${g.action}`}>
              {canDrillDown ? (
                <button
                  type="button"
                  onClick={() => setOpen(g)}
                  title={`List the ${g.n} ${g.action} ${g.entityType} row${g.n === 1 ? "" : "s"}`}
                  className="activity-digest__row activity-digest__row--button flex w-full items-baseline gap-3 py-2 text-left transition hover:bg-slate-50"
                >
                  {row}
                </button>
              ) : (
                <div className="activity-digest__row flex items-baseline gap-3 py-2">
                  {row}
                </div>
              )}
            </li>
          );
        })}
        {more > 0 ? (
          <li className="activity-digest__more py-2 text-xs text-slate-400">
            +{more} more kinds of change
          </li>
        ) : null}
      </ul>

      <ActivityDetailDialog
        group={open}
        onClose={() => setOpen(null)}
        scope={scope}
        products={products}
      />
    </>
  );
}

// One page is plenty for a drill-down: the panel's own counts say when a group
// is bigger than this, and the full log has its own screen.
const PAGE = 200;

function ActivityDetailDialog({
  group,
  onClose,
  scope,
  products,
}: {
  group: DigestGroup | null;
  onClose: () => void;
  scope: { from: string; to: string; label: string };
  products: string[];
}) {
  const q = useQuery<{ rows: AuditRow[]; hasMore: boolean }>({
    queryKey: [
      "audit-log",
      "digest",
      group?.entityType,
      group?.action,
      scope.from,
      scope.to,
      products.join(","),
    ],
    enabled: group !== null,
    queryFn: async () => {
      const params = new URLSearchParams({
        entity: group!.entityType,
        actions: group!.action,
        since: scope.from,
        until: scope.to,
        limit: String(PAGE),
      });
      if (products.length > 0) params.set("products", products.join(","));
      const r = await fetch(`/api/audit-log?${params.toString()}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const rows = q.data?.rows ?? [];

  return (
    <AppDialog
      open={group !== null}
      onClose={onClose}
      ariaLabel="Activity detail"
    >
      <div className="activity-dialog flex h-full flex-col overflow-hidden">
        <header className="activity-dialog__header toolbar flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 px-6 pr-14">
          <h2 className="flex items-baseline gap-2 text-base font-semibold text-slate-900">
            {group ? <ActionBadge action={group.action} /> : null}
            <span>{group?.entityType}</span>
            <span className="text-sm font-normal text-slate-500">
              {group?.n} write{group?.n === 1 ? "" : "s"} · {scope.label}
            </span>
          </h2>
        </header>

        <div className="activity-dialog__body flex-1 overflow-auto px-6 py-4">
          {q.isLoading ? (
            <div className="activity-dialog__loading flex items-center gap-2 text-sm text-slate-500">
              <Icon name="spinner" className="size-4 animate-spin" />
              Loading the log…
            </div>
          ) : q.isError ? (
            <div className="activity-dialog__error rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {(q.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No rows — the log for this window has been trimmed.
            </div>
          ) : (
            <>
              <table className="activity-dialog__table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">When</th>
                    <th className="py-1.5 pr-3 font-medium">What</th>
                    <th className="py-1.5 pr-3 font-medium">Id</th>
                    <th className="py-1.5 pr-3 font-medium">Changed</th>
                    <th className="py-1.5 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="activity-dialog__row border-b border-slate-100 align-top"
                    >
                      <td className="activity-dialog__when whitespace-nowrap py-1.5 pr-3 font-mono text-xs text-slate-500">
                        {r.createdAt.slice(5, 16)}
                      </td>
                      <td className="activity-dialog__what py-1.5 pr-3 text-xs text-slate-800">
                        {entityLabel(r)}
                      </td>
                      <td className="activity-dialog__id py-1.5 pr-3 font-mono text-xs text-slate-400">
                        {r.entityId}
                      </td>
                      <td className="activity-dialog__changed py-1.5 pr-3 text-xs text-slate-500">
                        {changedSummary(r)}
                      </td>
                      <td className="activity-dialog__by py-1.5 text-xs text-slate-500">
                        {r.userId ?? "system"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {q.data?.hasMore ? (
                <p className="activity-dialog__more mt-3 text-xs text-slate-400">
                  First {PAGE} rows shown — the window holds more.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppDialog>
  );
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The row in the words it was written in. Audit rows carry the whole entity as
 *  JSON, so the name a person would recognise is already there — it just has
 *  to be read out per entity type. */
function entityLabel(r: AuditRow): string {
  const o = parse(r.after) ?? parse(r.before);
  if (!o) return "—";
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
  const n = (k: string) => (typeof o[k] === "number" ? (o[k] as number) : null);

  // A run that touched many rows at once records what it did, not one entity.
  if (typeof o.kind === "string") return o.kind.replace(/_/g, " ");

  const mc = n("number");
  if (mc !== null) {
    const variant = s("variant") ?? "";
    const name = s("name");
    return `MC${mc}${variant}${name ? ` — ${name}` : ""}`;
  }
  return (
    s("fileName") ??
    s("name") ??
    s("title") ??
    s("key") ??
    s("label") ??
    s("email") ??
    "—"
  );
}

// Noise: every update touches these, and naming them would bury the fields the
// user actually changed.
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id", "clientId"]);
const MAX_FIELDS = 4;

/** Which fields an update actually moved — read from before/after, not stored
 *  separately, so it stays true for rows written before this panel existed. */
function changedSummary(r: AuditRow): string {
  const before = parse(r.before);
  const after = parse(r.after);
  if (!before || !after) return "—";
  const changed: string[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORED_FIELDS.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  if (changed.length === 0) return "—";
  const head = changed.slice(0, MAX_FIELDS).join(", ");
  return changed.length > MAX_FIELDS
    ? `${head} +${changed.length - MAX_FIELDS}`
    : head;
}
