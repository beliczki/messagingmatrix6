"use client";

import { useMemo } from "react";
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

  return (
    <div className="overflow-auto">
      <table className="border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              Audience ╲ Topic
            </th>
            {topics.map((t) => (
              <th
                key={t.id}
                className="sticky top-0 z-20 min-w-[160px] border-b border-r border-slate-200 bg-slate-50 p-2 text-left text-xs font-medium text-slate-700"
                title={t.key}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="truncate font-mono text-[10px] text-slate-400">
                  {t.key}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {audiences.map((a) => (
            <tr key={a.id}>
              <th
                className="sticky left-0 z-10 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 p-2 text-left text-xs font-medium text-slate-700"
                title={a.key}
              >
                <div className="font-semibold">{a.name}</div>
                <div className="font-mono text-[10px] text-slate-400">
                  {a.key}
                </div>
              </th>
              {topics.map((t) => {
                const list = cells.get(`${a.key}\0${t.key}`) ?? [];
                return (
                  <Cell
                    key={t.id}
                    audience={a.key}
                    topic={t.key}
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
