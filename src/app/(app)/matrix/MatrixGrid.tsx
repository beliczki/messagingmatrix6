"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import GridView from "./GridView";
import FeedView from "./FeedView";
import MatrixToolbar from "./MatrixToolbar";
import MessageEditor from "./MessageEditor";
import {
  type Audience,
  type Density,
  type Filters,
  type Message,
  type Topic,
  type View,
  EMPTY_FILTERS,
} from "./types";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function MatrixWorkspace() {
  const [view, setView] = useState<View>("grid");
  const [density, setDensity] = useState<Density>("informative");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);

  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () => fetchJSON<{ audiences: Audience[] }>("/api/audiences"),
  });
  const topicsQ = useQuery({
    queryKey: ["topics"],
    queryFn: () => fetchJSON<{ topics: Topic[] }>("/api/topics"),
  });
  const messagesQ = useQuery({
    queryKey: ["messages"],
    queryFn: () => fetchJSON<{ messages: Message[] }>("/api/messages"),
  });

  const audiences = audiencesQ.data?.audiences ?? [];
  const topics = topicsQ.data?.topics ?? [];
  const messages = messagesQ.data?.messages ?? [];

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of audiences) if (a.product) s.add(a.product);
    for (const t of topics) if (t.product) s.add(t.product);
    return [...s].sort();
  }, [audiences, topics]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) if (m.status) s.add(m.status);
    return [...s].sort();
  }, [messages]);

  const filtered = useMemo(() => {
    const ps = filters.products;
    const ss = filters.statuses;
    const term = filters.search.trim().toLowerCase();

    const auds =
      ps.size === 0 ? audiences : audiences.filter((a) => a.product && ps.has(a.product));
    const tops =
      ps.size === 0 ? topics : topics.filter((t) => t.product && ps.has(t.product));
    const audKeys = new Set(auds.map((a) => a.key));
    const topKeys = new Set(tops.map((t) => t.key));
    let msgs = messages.filter((m) => audKeys.has(m.audience) && topKeys.has(m.topic));
    if (ss.size > 0) msgs = msgs.filter((m) => m.status && ss.has(m.status));
    if (term) {
      msgs = msgs.filter((m) => {
        const label = `mc${m.number}${m.variant}`.toLowerCase();
        return (
          label.includes(term) ||
          (m.name ?? "").toLowerCase().includes(term) ||
          (m.headline ?? "").toLowerCase().includes(term) ||
          (m.pmmid ?? "").toLowerCase().includes(term)
        );
      });
    }
    return { auds, tops, msgs };
  }, [audiences, topics, messages, filters]);

  const openMessage = useMemo(
    () => messages.find((m) => m.id === openMessageId) ?? null,
    [messages, openMessageId],
  );

  const loading = audiencesQ.isLoading || topicsQ.isLoading || messagesQ.isLoading;
  const error = audiencesQ.error || topicsQ.error || messagesQ.error;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading matrix…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rose-600">
        {(error as Error).message}
      </div>
    );
  }
  if (audiences.length === 0 && topics.length === 0) return <EmptyState />;

  return (
    <div className="flex h-full flex-col">
      <MatrixToolbar
        view={view}
        setView={setView}
        density={density}
        setDensity={setDensity}
        filters={filters}
        setFilters={setFilters}
        productOptions={productOptions}
        statusOptions={statusOptions}
        counts={{
          audiences: audiences.length,
          topics: topics.length,
          messages: messages.length,
          visible: filtered.msgs.length,
        }}
      />

      <div className="relative flex-1 overflow-hidden">
        {view === "grid" ? (
          <GridView
            audiences={filtered.auds}
            topics={filtered.tops}
            messages={filtered.msgs}
            density={density}
            onOpenMessage={(id) => setOpenMessageId(id)}
          />
        ) : (
          <FeedView
            messages={filtered.msgs}
            audiences={audiences}
            topics={topics}
            onOpenMessage={(id) => setOpenMessageId(id)}
          />
        )}
      </div>

      <MessageEditor
        open={!!openMessage}
        message={openMessage}
        audiences={audiences}
        topics={topics}
        visibleMessages={filtered.msgs}
        onClose={() => setOpenMessageId(null)}
        onJump={(id) => setOpenMessageId(id)}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="text-base font-semibold text-slate-900">Empty matrix</h2>
        <p className="mt-1 text-sm text-slate-500">
          Add an audience and a topic to start. The matrix renders audiences as
          rows and topics as columns; each MC lives at the intersection.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          For a quick fill from the real Erste data, run:
        </p>
        <pre className="mt-1 rounded-md bg-slate-50 p-2 text-left font-mono text-[11px] text-slate-700">
{`ACTIVE_CLIENT_KEY=erste npx tsx \\
  scripts/import-erste-sample.ts`}
        </pre>
      </div>
    </div>
  );
}
