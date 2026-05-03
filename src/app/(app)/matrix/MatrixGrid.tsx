"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { LayoutList, List, Grip, Table2, ListFilter } from "lucide-react";
import clsx from "clsx";
import GridView from "./GridView";
import FeedView from "./FeedView";
import FeedExportPanel from "./FeedExportPanel";
import MatrixToolbar from "./MatrixToolbar";
import MessageEditor from "./MessageEditor";
import HeaderDetailDialog from "./HeaderDetailDialog";
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
import { parseSearchQuery, hasNarrowingPrefix } from "@/lib/search-query";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

const STORAGE_KEY = "mm6_matrix_state_v1";

type PersistedState = {
  view: View;
  density: Density;
  transposed: boolean;
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
  const [density, setDensity] = useState<Density>("detailed");
  const [transposed, setTransposed] = useState<boolean>(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openMessageId, setOpenMessageId] = useState<number | null>(null);
  const [headerDialog, setHeaderDialog] = useState<
    { kind: "audience" | "topic"; key: string } | null
  >(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const p = loadPersisted();
    if (p.view === "grid" || p.view === "feed") setView(p.view);
    const persistedDensity = p.density as string | undefined;
    if (persistedDensity === "detailed" || persistedDensity === "compact" || persistedDensity === "dense") {
      setDensity(persistedDensity);
    } else if (persistedDensity === "informative") {
      setDensity("detailed");
    } else if (persistedDensity === "minimal") {
      setDensity("compact");
    }
    if (typeof p.transposed === "boolean") setTransposed(p.transposed);
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
      transposed,
      filters: {
        products: [...filters.products],
        statuses: [...filters.statuses],
        search: filters.search,
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [hydrated, view, density, transposed, filters]);

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
  const templatesQ = useQuery({
    queryKey: ["templates", "folders"],
    queryFn: () =>
      fetchJSON<{
        templates: { name: string; sizes: string[]; defaultSize: string | null }[];
      }>("/api/templates/folders"),
  });

  const audiences = audiencesQ.data?.audiences ?? [];
  const topics = topicsQ.data?.topics ?? [];
  const messages = messagesQ.data?.messages ?? [];
  const templates = templatesQ.data?.templates ?? [];

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

  const audienceById = useMemo(
    () => new Map(audiences.map((a) => [a.key, a])),
    [audiences],
  );
  const topicById = useMemo(
    () => new Map(topics.map((t) => [t.key, t])),
    [topics],
  );

  const filtered = useMemo(() => {
    const ps = filters.products;
    const ss = filters.statuses;
    const predicate = parseSearchQuery(filters.search);
    const narrowing = hasNarrowingPrefix(filters.search);

    let auds =
      ps.size === 0 ? audiences : audiences.filter((a) => a.product && ps.has(a.product));
    let tops =
      ps.size === 0 ? topics : topics.filter((t) => t.product && ps.has(t.product));
    const audKeys = new Set(auds.map((a) => a.key));
    const topKeys = new Set(tops.map((t) => t.key));
    let msgs = messages.filter((m) => audKeys.has(m.audience) && topKeys.has(m.topic));
    if (ss.size > 0) msgs = msgs.filter((m) => m.status && ss.has(m.status));
    if (filters.search.trim()) {
      msgs = msgs.filter((m) => {
        const a = audienceById.get(m.audience);
        const t = topicById.get(m.topic);
        const audience = `${m.audience} ${a?.name ?? ""}`.toLowerCase();
        const topic = `${m.topic} ${t?.name ?? ""}`.toLowerCase();
        const strategy = (a?.strategy ?? "").toLowerCase();
        const platform = (a?.buyingPlatform ?? "").toLowerCase();
        const mc = `mc${m.number}${m.variant} ${m.pmmid ?? ""}`.toLowerCase();
        const free = `${m.name ?? ""} ${m.headline ?? ""} ${m.copy1 ?? ""} ${m.copy2 ?? ""} ${m.disclaimer ?? ""} ${m.cta ?? ""} ${audience} ${topic} ${strategy} ${platform} ${a?.lineitemId ?? ""} ${a?.comment ?? ""} ${t?.comment ?? ""} ${m.pmmid ?? ""}`.toLowerCase();
        return predicate({ audience, topic, strategy, platform, mc, free });
      });
    }
    if (narrowing) {
      const usedAudKeys = new Set(msgs.map((m) => m.audience));
      const usedTopKeys = new Set(msgs.map((m) => m.topic));
      auds = auds.filter((a) => usedAudKeys.has(a.key));
      tops = tops.filter((t) => usedTopKeys.has(t.key));
    }
    return { auds, tops, msgs };
  }, [audiences, topics, messages, filters, audienceById, topicById]);

  const openMessage = useMemo(
    () => messages.find((m) => m.id === openMessageId) ?? null,
    [messages, openMessageId],
  );

  const headerEntity = useMemo(() => {
    if (!headerDialog) return null;
    if (headerDialog.kind === "audience") {
      return audiences.find((a) => a.key === headerDialog.key) ?? null;
    }
    return topics.find((t) => t.key === headerDialog.key) ?? null;
  }, [headerDialog, audiences, topics]);

  const headerMessages = useMemo(() => {
    if (!headerDialog) return [];
    return filtered.msgs.filter((m) =>
      headerDialog.kind === "audience"
        ? m.audience === headerDialog.key
        : m.topic === headerDialog.key,
    );
  }, [headerDialog, filtered.msgs]);

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
            visibleAudiences: filtered.auds.length,
            visibleTopics: filtered.tops.length,
          }}
        />

        <div className="relative flex-1 overflow-hidden">
          {view === "grid" ? (
            <GridView
              audiences={filtered.auds}
              topics={filtered.tops}
              messages={filtered.msgs}
              density={density}
              transposed={transposed}
              setTransposed={setTransposed}
              onOpenMessage={(id) => setOpenMessageId(id)}
              onOpenHeader={(kind, key) => setHeaderDialog({ kind, key })}
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
                    { value: "detailed", icon: <LayoutList className="size-4" />, label: "Detailed" },
                    { value: "compact", icon: <List className="size-4" />, label: "Compact" },
                    { value: "dense", icon: <Grip className="size-4" />, label: "Dense" },
                  ]}
                  value={density}
                  onChange={setDensity}
                />
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <ViewControls
                view={view}
                setView={setView}
                density={density}
                setDensity={setDensity}
              />
              {view === "feed" ? (
                <FeedExportPanel
                  filters={filters}
                  filteredMessages={filtered.msgs}
                />
              ) : null}
            </div>
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

      {headerDialog && headerEntity ? (
        <HeaderDetailDialog
          kind={headerDialog.kind}
          entity={headerEntity}
          messages={headerMessages}
          templates={templates}
          onClose={() => setHeaderDialog(null)}
        />
      ) : null}
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
          <div className="toggle-group toggle-group--icon-only flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
            <ToggleBtn
              active={density === "detailed"}
              onClick={() => setDensity("detailed")}
              title="Detailed"
              ariaLabel="Detailed density"
            >
              <LayoutList className="size-4" />
            </ToggleBtn>
            <ToggleBtn
              active={density === "compact"}
              onClick={() => setDensity("compact")}
              title="Compact"
              ariaLabel="Compact density"
            >
              <List className="size-4" />
            </ToggleBtn>
            <ToggleBtn
              active={density === "dense"}
              onClick={() => setDensity("dense")}
              title="Dense"
              ariaLabel="Dense density"
            >
              <Grip className="size-4" />
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
  title,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
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
