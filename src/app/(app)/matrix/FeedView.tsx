"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { evaluatePattern } from "@/lib/patterns";
import {
  parseFeedColumns,
  resolveFeedPattern,
} from "@/lib/feed-patterns";
import { type Audience, type Message, type Topic, STATUS_COLOR } from "./types";

type SortDir = "asc" | "desc";

type ConfigRow = { key: string; value: unknown };

type Patterns = {
  feed?: Record<string, string>;
  [key: string]: unknown;
};

async function fetchFeedStructure(): Promise<string> {
  const r = await fetch("/api/config?key=feedStructure", {
    credentials: "include",
  });
  if (!r.ok) return "";
  const data = (await r.json()) as { rows: ConfigRow[] };
  const v = data.rows[0]?.value;
  return typeof v === "string" ? v : "";
}

async function fetchPatterns(): Promise<Patterns> {
  const r = await fetch("/api/config?key=patterns", {
    credentials: "include",
  });
  if (!r.ok) return {};
  const data = (await r.json()) as { rows: ConfigRow[] };
  const v = data.rows[0]?.value;
  return v && typeof v === "object" ? (v as Patterns) : {};
}

export default function FeedView({
  messages,
  audiences,
  topics,
  onOpenMessage,
}: {
  messages: Message[];
  audiences: Audience[];
  topics: Topic[];
  onOpenMessage: (id: number) => void;
}) {
  const feedStructureQ = useQuery({
    queryKey: ["config", "feedStructure"],
    queryFn: fetchFeedStructure,
  });
  const patternsQ = useQuery({
    queryKey: ["config", "patterns"],
    queryFn: fetchPatterns,
  });

  const feedStructure = feedStructureQ.data ?? "";
  const feedPatterns = useMemo(
    () => patternsQ.data?.feed ?? {},
    [patternsQ.data],
  );

  const columns = useMemo(
    () => parseFeedColumns(feedStructure),
    [feedStructure],
  );

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const audIndex = useMemo(
    () => new Map(audiences.map((a) => [a.key, a])),
    [audiences],
  );
  const topIndex = useMemo(
    () => new Map(topics.map((t) => [t.key, t])),
    [topics],
  );

  // Pre-compute every cell for every visible message so sorting doesn't
  // re-evaluate patterns on every comparator call.
  const rows = useMemo(() => {
    if (columns.length === 0) return [];
    return messages.map((m) => {
      const aud = audIndex.get(m.audience) ?? null;
      const top = topIndex.get(m.topic) ?? null;
      const ctx: Record<string, unknown> = {
        ...m,
        audience_key: m.audience,
        topic_key: m.topic,
        audience_name: aud?.name ?? "",
        topic_name: top?.name ?? "",
        product: aud?.product ?? top?.product ?? "",
        strategy: aud?.strategy ?? "",
        device: aud?.device ?? "",
        targeting_type: aud?.targetingType ?? "",
        audiences,
        topics,
      };
      const cells: Record<string, string> = {};
      for (const col of columns) {
        const pattern = resolveFeedPattern(col, feedPatterns);
        let value = evaluatePattern(pattern, ctx);
        if (value) value = value.replace(/[\r\n]+/g, " ").trim();
        cells[col] = value;
      }
      return { message: m, cells };
    });
  }, [messages, columns, feedPatterns, audIndex, topIndex, audiences, topics]);

  const sorted = useMemo(() => {
    if (!sortColumn) return rows;
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = a.cells[sortColumn] ?? "";
      const vb = b.cells[sortColumn] ?? "";
      const cmp = va.localeCompare(vb, undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortColumn, sortDir]);

  function toggleSort(col: string) {
    if (col === sortColumn) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  }

  if (feedStructureQ.isLoading || patternsQ.isLoading) {
    return (
      <div className="matrix-feed__loading flex h-full items-center justify-center text-sm text-slate-500">
        Loading feed configuration…
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="matrix-feed__empty p-8 text-center text-sm text-slate-500">
        No feed columns defined. Configure{" "}
        <span className="font-mono">Feed structure</span> in Settings →
        Structure to populate the feed view.
      </div>
    );
  }

  return (
    <div className="matrix-feed h-full overflow-auto">
      <table className="matrix-feed__table border-collapse text-sm" style={{ width: "max-content", minWidth: "100%" }}>
        <thead className="matrix-feed__head sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {columns.map((col) => (
              <Th
                key={col}
                column={col}
                cur={sortColumn}
                dir={sortDir}
                onClick={() => toggleSort(col)}
              >
                {col}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ message: m, cells }) => {
            const dot = STATUS_COLOR[m.status ?? ""] ?? "bg-slate-300";
            return (
              <tr
                key={m.id}
                onClick={() => onOpenMessage(m.id)}
                className="matrix-feed__row matrix-feed__row--clickable cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                {columns.map((col, idx) => {
                  const raw = cells[col] ?? "";
                  const display = truncateForDisplay(col, raw);
                  return (
                    <td
                      key={col}
                      className="matrix-feed__cell relative border border-slate-200 px-3 py-1.5 text-slate-700"
                      title={raw}
                    >
                      {idx === 0 ? (
                        <span
                          className={clsx(
                            "matrix-feed__status-stripe absolute left-0 top-0 h-full w-1",
                            dot,
                          )}
                          aria-label={m.status ?? "no status"}
                          title={m.status ?? ""}
                        />
                      ) : null}
                      <div className="whitespace-pre-wrap break-words">
                        {display || (
                          <span className="text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 ? (
        <div className="matrix-feed__empty p-8 text-center text-sm text-slate-500">
          No messages match the current filters.
        </div>
      ) : null}
    </div>
  );
}

function truncateForDisplay(column: string, value: string): string {
  if (!value) return value;
  const lower = column.toLowerCase();
  if (lower.includes("clicktag") || lower.includes("landing") || lower.includes("css")) {
    return value.length > 24 ? value.slice(0, 24) + "…" : value;
  }
  return value;
}

function Th({
  column,
  cur,
  dir,
  onClick,
  children,
}: {
  column: string;
  cur: string | null;
  dir: SortDir;
  onClick: (k: string) => void;
  children: React.ReactNode;
}) {
  const active = cur === column;
  return (
    <th
      onClick={() => onClick(column)}
      className={clsx(
        "matrix-feed__col-header cursor-pointer select-none whitespace-nowrap border border-slate-200 bg-slate-100 px-3 py-2 text-left",
        active
          ? "matrix-feed__col-header--sorted text-slate-900"
          : "hover:text-slate-700",
      )}
    >
      <div className="inline-flex items-center gap-1">
        {children}
        {active ? (
          dir === "asc" ? (
            <ChevronUp className="matrix-feed__sort-icon size-3" />
          ) : (
            <ChevronDown className="matrix-feed__sort-icon size-3" />
          )
        ) : null}
      </div>
    </th>
  );
}
