"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  type Audience,
  type Density,
  type Message,
  type Topic,
  STATUS_COLOR,
} from "./types";

export default function GridView({
  audiences,
  topics,
  messages,
  density,
  onOpenMessage,
}: {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  density: Density;
  onOpenMessage: (id: number) => void;
}) {
  const [transposed, setTransposed] = useState(false);

  const cells = useMemo(() => {
    const m = new Map<string, Message[]>();
    for (const msg of messages) {
      const key = `${msg.audience}\0${msg.topic}`;
      const arr = m.get(key);
      if (arr) arr.push(msg);
      else m.set(key, [msg]);
    }
    return m;
  }, [messages]);

  if (audiences.length === 0 || topics.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Add at least one audience and one topic to populate the grid.
      </div>
    );
  }

  const rows = transposed ? topics : audiences;
  const cols = transposed ? audiences : topics;
  const rowLabel = transposed ? "Topic" : "Audience";
  const colLabel = transposed ? "Audience" : "Topic";

  return (
    <div className="overflow-auto">
      <table className="border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 h-20 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 p-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <div className="flex h-full min-h-20 items-center justify-center p-2">
                <button
                  type="button"
                  onClick={() => setTransposed((v) => !v)}
                  title={`Transpose — show ${transposed ? "audiences" : "topics"} as rows`}
                  aria-label="Transpose matrix"
                  className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-slate-200/60"
                >
                  <span>{rowLabel}</span>
                  <span className="text-base font-normal text-slate-400">
                    {transposed ? "╱" : "╲"}
                  </span>
                  <span>{colLabel}</span>
                </button>
              </div>
            </th>
            {cols.map((c) => (
              <th
                key={c.id}
                className="sticky top-0 z-20 h-20 min-h-20 min-w-[160px] border-b border-r border-slate-200 bg-slate-50 p-2 align-top text-left text-xs font-medium text-slate-700"
                title={c.key}
              >
                <div className="font-semibold">{c.name}</div>
                <div className="truncate font-mono text-[10px] text-slate-400">
                  {c.key}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th
                className="sticky left-0 z-10 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 p-2 text-left text-xs font-medium text-slate-700"
                title={r.key}
              >
                <div className="font-semibold">{r.name}</div>
                <div className="font-mono text-[10px] text-slate-400">
                  {r.key}
                </div>
              </th>
              {cols.map((c) => {
                const audKey = transposed ? c.key : r.key;
                const topKey = transposed ? r.key : c.key;
                const list = cells.get(`${audKey}\0${topKey}`) ?? [];
                return (
                  <Cell
                    key={c.id}
                    audience={audKey}
                    topic={topKey}
                    messages={list}
                    density={density}
                    onOpenMessage={onOpenMessage}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  audience,
  topic,
  messages,
  density,
  onOpenMessage,
}: {
  audience: string;
  topic: string;
  messages: Message[];
  density: Density;
  onOpenMessage: (id: number) => void;
}) {
  return (
    <td
      className={clsx(
        "min-w-[160px] border-b border-r border-slate-200 align-top p-1.5",
        messages.length === 0 ? "bg-slate-50/50" : "bg-white",
      )}
      data-audience={audience}
      data-topic={topic}
    >
      <div
        className={clsx(
          "flex flex-wrap gap-1",
          density === "minimal" && "gap-1.5",
        )}
      >
        {messages.map((m) => (
          <McChip
            key={m.id}
            message={m}
            density={density}
            onClick={() => onOpenMessage(m.id)}
          />
        ))}
      </div>
    </td>
  );
}

function McChip({
  message,
  density,
  onClick,
}: {
  message: Message;
  density: Density;
  onClick: () => void;
}) {
  const label = `MC${message.number}${message.variant}`;
  const dot = STATUS_COLOR[message.status ?? ""] ?? "bg-slate-300";
  if (density === "minimal") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className={clsx(
          "size-2.5 cursor-pointer rounded-full transition hover:ring-2 hover:ring-slate-300",
          dot,
        )}
      />
    );
  }
  return (
    <button
      onClick={onClick}
      title={`${label} · ${message.name ?? "(unnamed)"}`}
      className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs transition hover:border-slate-400 hover:bg-slate-50"
    >
      <span className={clsx("size-1.5 rounded-full", dot)} />
      <span className="font-mono text-slate-700">{label}</span>
    </button>
  );
}
