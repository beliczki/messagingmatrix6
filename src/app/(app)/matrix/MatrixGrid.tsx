"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Layers, Rows3, Table2, ListFilter } from "lucide-react";
import clsx from "clsx";
import GridView from "./GridView";
import FeedView from "./FeedView";
import MatrixToolbar from "./MatrixToolbar";
import MessageEditor from "./MessageEditor";
import RightToolbar from "../_components/RightToolbar";
import CycleIconButton from "../_components/CycleIconButton";
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

const STORAGE_KEY = "mm6_matrix_state_v1";

type PersistedState = {
  view: View;
  density: Density;
  filters: { products: string[]; statuses: string[]; search: string };
};

function loadPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export default function MatrixWorkspace() {
  const [view, setView] = useState<View>("grid");
  const [density, setDensity] = useState<Density>("informative");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadPersisted();
    if (p.view === "grid" || p.view === "feed") setView(p.view);
    if (p.density === "informative" || p.density === "minimal") {
      setDensity(p.density);
    }
    if (p.filters) {
      setFilters({
        products: new Set(p.filters.products ?? []),
        statuses: new Set(p.filters.statuses ?? []),
        search: p.filters.search ?? "",
      });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    const payload: PersistedState = {
      view,
      density,
      filters: {
        products: [...filters.products],
        statuses: [...filters.statuses],
        search: filters.search,
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hydrated, view, density, filters]);

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
    <div className="matrix flex h-full">
      <div className="matrix__content flex flex-1 flex-col overflow-hidden">
        <MatrixToolbar
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
      </div>

      <RightToolbar storageKey="mm6_matrix_right_toolbar_open">
        {(collapsed) =>
          collapsed ? (
            <>
              <CycleIconButton
                options={[
                  { value: "grid", icon: <Table2 className="size-4" />, label: "Grid view" },
                  { value: "feed", icon: <ListFilter className="size-4" />, label: "Feed view" },
                ]}
                value={view}
                onChange={setView}
              />
              {view === "grid" ? (
                <CycleIconButton
                  options={[
                    { value: "informative", icon: <Layers className="size-4" />, label: "Informative" },
                    { value: "minimal", icon: <Rows3 className="size-4" />, label: "Minimal" },
                  ]}
                  value={density}
                  onChange={setDensity}
                />
              ) : null}
            </>
          ) : (
            <ViewControls
              view={view}
              setView={setView}
              density={density}
              setDensity={setDensity}
            />
          )
        }
      </RightToolbar>

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

function ViewControls({
  view,
  setView,
  density,
  setDensity,
}: {
  view: View;
  setView: (v: View) => void;
  density: Density;
  setDensity: (d: Density) => void;
}) {
  return (
    <div className="matrix-view-controls flex flex-col gap-3">
      <div className="matrix-view-controls__section">
        <div className="matrix-view-controls__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          View
        </div>
        <div className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
          <ToggleBtn active={view === "grid"} onClick={() => setView("grid")}>
            <Table2 className="size-3.5" />
            Grid
          </ToggleBtn>
          <ToggleBtn active={view === "feed"} onClick={() => setView("feed")}>
            <ListFilter className="size-3.5" />
            Feed
          </ToggleBtn>
        </div>
      </div>

      {view === "grid" ? (
        <div className="matrix-view-controls__section">
          <div className="matrix-view-controls__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Density
          </div>
          <div className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            <ToggleBtn
              active={density === "informative"}
              onClick={() => setDensity("informative")}
            >
              <Layers className="size-3.5" />
              Informative
            </ToggleBtn>
            <ToggleBtn
              active={density === "minimal"}
              onClick={() => setDensity("minimal")}
            >
              <Rows3 className="size-3.5" />
              Minimal
            </ToggleBtn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "toggle-btn flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1",
        active
          ? "toggle-btn--active bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="empty-state matrix-empty-state max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <h2 className="empty-state__title text-base font-semibold text-slate-900">Empty matrix</h2>
        <p className="empty-state__hint mt-1 text-sm text-slate-500">
          Add an audience and a topic to start. The matrix renders audiences as
          rows and topics as columns; each MC lives at the intersection.
        </p>
        <p className="empty-state__hint mt-3 text-xs text-slate-500">
          For a quick fill from the real Erste data, run:
        </p>
        <pre className="matrix-empty-state__hint mt-1 rounded-md bg-slate-50 p-2 text-left font-mono text-[11px] text-slate-700">
{`ACTIVE_CLIENT_KEY=erste npx tsx \\
  scripts/import-erste-sample.ts`}
        </pre>
      </div>
    </div>
  );
}
