"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type Audience, type Message, type Topic, STATUS_COLOR } from "./types";

type SortKey =
  | "mcLabel"
  | "status"
  | "audience"
  | "topic"
  | "name"
  | "headline"
  | "template"
  | "updatedAt";

type SortDir = "asc" | "desc";

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
  const [sortKey, setSortKey] = useState<SortKey>("mcLabel");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const audIndex = useMemo(
    () => new Map(audiences.map((a) => [a.key, a])),
    [audiences],
  );
  const topIndex = useMemo(
    () => new Map(topics.map((t) => [t.key, t])),
    [topics],
  );

  const sorted = useMemo(() => {
    const arr = [...messages];
    arr.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [messages, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <Th sk="mcLabel" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              MC
            </Th>
            <Th sk="status" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Status
            </Th>
            <Th sk="audience" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Audience
            </Th>
            <Th sk="topic" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Topic
            </Th>
            <Th sk="name" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Name
            </Th>
            <Th sk="headline" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Headline
            </Th>
            <Th sk="template" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Template
            </Th>
            <Th sk="updatedAt" cur={sortKey} dir={sortDir} onClick={toggleSort}>
              Updated
            </Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => {
            const aud = audIndex.get(m.audience);
            const top = topIndex.get(m.topic);
            const dot = STATUS_COLOR[m.status ?? ""] ?? "bg-slate-300";
            return (
              <tr
                key={m.id}
                onClick={() => onOpenMessage(m.id)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-1.5 font-mono text-slate-900">
                  MC{m.number}
                  {m.variant}
                </td>
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={clsx("size-2 rounded-full", dot)} />
                    <span className="text-slate-700">
                      {m.status ?? "—"}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <div className="font-medium text-slate-700">
                    {aud?.name ?? m.audience}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    {m.audience}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <div className="font-medium text-slate-700">
                    {top?.name ?? m.topic}
                  </div>
                  <div className="truncate font-mono text-[10px] text-slate-400">
                    {m.topic}
                  </div>
                </td>
                <td className="max-w-[220px] truncate px-3 py-1.5">
                  {m.name ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="max-w-[280px] truncate px-3 py-1.5 text-slate-600">
                  {m.headline ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {m.template ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-400">
                  {m.updatedAt}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-500">
          No messages match the current filters.
        </div>
      ) : null}
    </div>
  );
}

function sortValue(m: Message, k: SortKey): string | number {
  switch (k) {
    case "mcLabel":
      // Sort by number then variant.
      return m.number * 1000 + m.variant.charCodeAt(0);
    case "status":
      return m.status ?? "";
    case "audience":
      return m.audience;
    case "topic":
      return m.topic;
    case "name":
      return (m.name ?? "").toLowerCase();
    case "headline":
      return (m.headline ?? "").toLowerCase();
    case "template":
      return m.template ?? "";
    case "updatedAt":
      return m.updatedAt;
  }
}

function Th({
  sk,
  cur,
  dir,
  onClick,
  children,
}: {
  sk: SortKey;
  cur: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = cur === sk;
  return (
    <th
      onClick={() => onClick(sk)}
      className={clsx(
        "cursor-pointer select-none border-b border-slate-200 px-3 py-2 text-left",
        active ? "text-slate-900" : "hover:text-slate-700",
      )}
    >
      <div className="inline-flex items-center gap-1">
        {children}
        {active ? (
          dir === "asc" ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )
        ) : null}
      </div>
    </th>
  );
}
