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
  transposed,
  setTransposed,
  onOpenMessage,
  onOpenHeader,
}: {
  audiences: Audience[];
  topics: Topic[];
  messages: Message[];
  density: Density;
  transposed: boolean;
  setTransposed: (v: boolean) => void;
  onOpenMessage: (id: number) => void;
  onOpenHeader: (kind: "audience" | "topic", key: string) => void;
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

  const rows = transposed ? topics : audiences;
  const cols = transposed ? audiences : topics;
  const rowLabel = transposed ? "Topic" : "Audience";
  const colLabel = transposed ? "Audience" : "Topic";
  const rowKind: "audience" | "topic" = transposed ? "topic" : "audience";
  const colKind: "audience" | "topic" = transposed ? "audience" : "topic";

  return (
    <div className="matrix-grid h-full overflow-auto">
      <table className="border-separate border-spacing-0">
        <thead className="matrix-grid__head">
          <tr>
            <th className="matrix-grid__corner sticky left-0 top-0 z-30 h-20 min-w-[180px] border-b border-r border-border bg-surface-alt p-0 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <div className="flex h-full min-h-20 items-center justify-center p-2">
                <button
                  type="button"
                  onClick={() => setTransposed(!transposed)}
                  title={`Transpose — show ${transposed ? "audiences" : "topics"} as rows`}
                  aria-label="Transpose matrix"
                  className="matrix-grid__transpose-btn inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <span>{rowLabel}</span>
                  <span className="text-base font-normal text-text-tertiary">
                    {transposed ? "╱" : "╲"}
                  </span>
                  <span>{colLabel}</span>
                </button>
              </div>
            </th>
            {cols.map((c) => (
              <th
                key={c.id}
                className={clsx(
                  "matrix-grid__col-header sticky top-0 z-20 border-b border-r border-border bg-surface-alt align-top text-left font-medium text-text-primary",
                  density === "dense"
                    ? "matrix-grid__col-header--dense h-40 min-h-40 w-7 min-w-7 max-w-7 p-0"
                    : "h-20 min-h-20 min-w-[160px] p-0",
                )}
                title={c.key}
              >
                <button
                  type="button"
                  onClick={() => onOpenHeader(colKind, c.key)}
                  className={clsx(
                    "matrix-grid__col-header-btn block size-full text-left transition hover:bg-black/5 dark:hover:bg-white/10",
                    density === "dense" ? "p-1" : "p-2",
                  )}
                  aria-label={`Open ${colKind} ${c.name}`}
                >
                  {density === "dense" ? (
                    <div className="matrix-grid__col-header-label--vertical flex h-full items-end justify-center">
                      <span className="font-semibold text-[10px] text-text-primary [writing-mode:vertical-rl] [transform:rotate(180deg)] truncate max-h-full">
                        {c.name}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div
                        className={clsx(
                          "matrix-grid__col-header-label font-semibold",
                          density === "compact" ? "text-[10px]" : "text-xs",
                        )}
                      >
                        {c.name}
                      </div>
                      {density === "detailed" ? (
                        <div className="matrix-grid__col-header-key truncate font-mono text-[10px] text-text-tertiary">
                          {c.key}
                        </div>
                      ) : null}
                    </>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="matrix-grid__row">
              <th
                className={clsx(
                  "matrix-grid__row-header sticky left-0 z-10 border-b border-r border-border bg-surface-alt text-left font-medium text-text-primary",
                  density === "dense" ? "min-w-[140px] p-0" : "min-w-[180px] p-0",
                )}
                title={r.key}
              >
                <button
                  type="button"
                  onClick={() => onOpenHeader(rowKind, r.key)}
                  className={clsx(
                    "matrix-grid__row-header-btn block size-full text-left transition hover:bg-black/5 dark:hover:bg-white/10",
                    density === "dense" ? "p-1" : "p-2",
                  )}
                  aria-label={`Open ${rowKind} ${r.name}`}
                >
                  <div
                    className={clsx(
                      "matrix-grid__row-header-label font-semibold",
                      density === "detailed" ? "text-xs" : "text-[10px]",
                    )}
                  >
                    {r.name}
                  </div>
                  {density === "detailed" ? (
                    <div className="matrix-grid__row-header-key font-mono text-[10px] text-text-tertiary">
                      {r.key}
                    </div>
                  ) : null}
                </button>
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
        "matrix-grid__cell border-b border-r border-border align-top",
        density === "dense"
          ? "matrix-grid__cell--dense w-7 min-w-7 max-w-7 p-0.5"
          : "min-w-[160px] p-1.5",
        messages.length === 0
          ? "bg-slate-50/50 dark:bg-white/[0.03]"
          : "matrix-grid__cell--has-messages bg-surface",
      )}
      data-audience={audience}
      data-topic={topic}
    >
      <div
        className={clsx(
          "flex flex-wrap",
          density === "dense" ? "gap-0.5 justify-center" : "gap-1",
          density === "compact" && "gap-1.5",
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
  if (density === "dense") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className={clsx(
          "mc-chip mc-chip--dense size-2.5 cursor-pointer rounded-full transition hover:ring-2 hover:ring-border-subtle",
          dot,
        )}
      />
    );
  }
  if (density === "compact") {
    return (
      <button
        onClick={onClick}
        title={`${label} · ${message.name ?? "(unnamed)"}`}
        className="mc-chip mc-chip--compact inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] transition hover:border-border-subtle hover:bg-surface-alt"
      >
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span className="mc-chip__label font-mono text-text-primary">{label}</span>
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      title={`${label} · ${message.name ?? "(unnamed)"}`}
      className="mc-chip mc-chip--detailed flex max-w-full cursor-pointer flex-col items-start gap-0.5 rounded border border-border bg-surface px-1.5 py-1 text-xs transition hover:border-border-subtle hover:bg-surface-alt"
    >
      <span className="mc-chip__line mc-chip__line--label inline-flex items-center gap-1.5">
        <span className={clsx("mc-chip__dot status-dot size-1.5 rounded-full", dot)} />
        <span className="mc-chip__label font-mono text-text-primary">{label}</span>
      </span>
      {message.name ? (
        <span className="mc-chip__line mc-chip__line--name max-w-full truncate text-[10px] text-text-secondary">
          {message.name}
        </span>
      ) : null}
    </button>
  );
}
