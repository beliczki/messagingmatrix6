"use client";

// The drafts surface: work that has been taken on and has claimed its MC
// number, but has not been placed in the matrix yet. A draft is a `messages`
// row with no audience, so everything here — previews, versioning, editing —
// runs on the ordinary message machinery; what makes it a draft is the missing
// cell, and promoting is what fills it in.
//
// ONE flat wall of cards, filtered — not grouped. Every draft carries its
// product as a tag, so the page no longer has to be cut into sections to say
// which is which: reading it off a card is one glance, narrowing to a product
// is one click. Grouping forced a shape on the page even when nobody was
// asking the question it answered.
//
// The toolbar is the matrix's on purpose: the same `parseSearchQuery` language
// (mc:, t:, free text, OR, quotes) and the same Product MultiPill, so one
// filter habit works on both pages.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Filter as FilterIcon,
  FlaskConical,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import MultiPill, { ALL_NONE_QUICK_SELECT } from "../_components/MultiPill";
import RightToolbar from "../_components/RightToolbar";
import MessageEditor from "../matrix/MessageEditor";
import {
  channelToAudience,
  type Audience,
  type Channel,
  type Topic,
} from "../matrix/types";
import { emptySearchFields, parseSearchQuery } from "@/lib/search-query";
import type { Draft, DraftPreview, BriefRow } from "./types";

// Filter option for the drafts that have no product yet. They were a group of
// their own before; staying able to isolate them is why this is an option
// rather than simply "matched by no product".
const NO_PRODUCT = "(no product)";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
  return json as T;
}

export function mcLabel(d: { number: number; variant: string }): string {
  return `MC${d.number}${d.variant}`;
}

export default function DraftsView() {
  const [detailId, setDetailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  // The Promote tab offers both axes, so it needs both halves of the audience
  // list. Channels are merged in as Audience-shaped rows (channel = code) the
  // same way MatrixGrid does it — one list, partitioned on `channel`.
  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () =>
      fetchJSON<{ audiences: Audience[] }>("/api/audiences").then(
        (d) => d.audiences,
      ),
  });
  const channelsQ = useQuery({
    queryKey: ["channels"],
    queryFn: () =>
      fetchJSON<{ channels: Channel[] }>("/api/channels").then(
        (d) => d.channels,
      ),
  });
  const topicsQ = useQuery({
    queryKey: ["topics"],
    queryFn: () =>
      fetchJSON<{ topics: Topic[] }>("/api/topics").then((d) => d.topics),
  });
  const audiences = useMemo(
    () => [
      ...(audiencesQ.data ?? []),
      ...(channelsQ.data ?? []).map(channelToAudience),
    ],
    [audiencesQ.data, channelsQ.data],
  );

  const draftsQ = useQuery({
    queryKey: ["drafts"],
    queryFn: () =>
      fetchJSON<{
        drafts: Draft[];
        previews: DraftPreview[];
        briefs: BriefRow[];
      }>("/api/drafts"),
  });

  // Memoised rather than `?? []` inline: a fresh empty array on every render
  // invalidates the grouping memo below on every render too.
  const data = draftsQ.data;
  const drafts = useMemo(() => data?.drafts ?? [], [data]);
  const previews = useMemo(() => data?.previews ?? [], [data]);

  const previewsByDraft = useMemo(() => {
    const m = new Map<number, DraftPreview[]>();
    for (const p of previews) {
      const list = m.get(p.messageId) ?? [];
      list.push(p);
      m.set(p.messageId, list);
    }
    return m;
  }, [previews]);

  // The product vocabulary is whatever the drafts actually carry, alphabetical,
  // with "(no product)" last — it is the one option that is not a product.
  const productOptions = useMemo(() => {
    const named = new Set<string>();
    let loose = false;
    for (const d of drafts) {
      if (d.draftProduct) named.add(d.draftProduct);
      else loose = true;
    }
    const out = [...named].sort((a, b) => a.localeCompare(b));
    if (loose) out.push(NO_PRODUCT);
    return out;
  }, [drafts]);

  const productCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of drafts) {
      const key = d.draftProduct ?? NO_PRODUCT;
      m[key] = (m[key] ?? 0) + 1;
    }
    return m;
  }, [drafts]);

  // An empty product set means "no product filter", exactly as on the matrix —
  // the pill narrows, it never starts by hiding everything.
  const visible = useMemo(() => {
    const match = parseSearchQuery(search);
    return drafts.filter((d) => {
      if (products.size > 0 && !products.has(d.draftProduct ?? NO_PRODUCT)) {
        return false;
      }
      // A draft has no cell, so the audience/strategy/platform axes of the
      // query language have nothing to match — topic and mc do, and free text
      // sees everything the card shows. Lowercase throughout: the parser
      // lowercases the query, so a field that is not lowered never matches.
      return match({
        ...emptySearchFields(),
        topic: (d.topic ?? "").toLowerCase(),
        mc: mcLabel(d).toLowerCase(),
        free: [mcLabel(d), d.name ?? "", d.topic ?? "", d.draftProduct ?? ""]
          .join(" ")
          .toLowerCase(),
      });
    });
  }, [drafts, products, search]);

  const detail = drafts.find((d) => d.id === detailId) ?? null;

  function refresh() {
    qc.invalidateQueries({ queryKey: ["drafts"] });
  }

  async function newDraft() {
    await postJSON("/api/drafts", {});
    refresh();
  }

  return (
    <div className="drafts-view flex h-full overflow-hidden">
      <div className="drafts-view__main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="toolbar drafts-view__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
          <div className="toolbar__title text-sm font-semibold text-slate-900">
            Drafts
          </div>

          <div className="input-box input-box--with-icon relative ml-2">
            <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Filter… t: mc: OR …"
              title='Free text searches the MC label, name, product and working title. Prefixes: t: (working title), mc: (MC#). AND implicit, OR explicit. Quote "two words" for phrases.'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
            />
          </div>

          <MultiPill
            label="Product"
            values={products}
            options={productOptions}
            optionCounts={productCounts}
            quickSelect={ALL_NONE_QUICK_SELECT}
            onChange={setProducts}
          />

          {products.size > 0 || search ? (
            <button
              type="button"
              onClick={() => {
                setProducts(new Set());
                setSearch("");
              }}
              className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
            >
              <X className="size-3" />
              Clear
            </button>
          ) : null}

          <div className="toolbar__count ml-auto text-[11px] tabular-nums text-slate-500">
            {visible.length}/{drafts.length} open
          </div>
        </div>

        <div className="drafts-view__scroll flex-1 overflow-auto p-4">
          {draftsQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="empty-state drafts-view__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <FlaskConical className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
                <h2 className="empty-state__title text-sm font-semibold text-slate-900">
                  Nothing in progress
                </h2>
                <p className="empty-state__hint mt-1 text-xs text-slate-500">
                  A draft claims its MC number the moment work is taken on, so
                  the number stops moving before the card reaches the matrix.
                  Start one from the toolbar — its product, brief and cell can
                  all arrive later.
                </p>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="empty-state drafts-view__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <FlaskConical className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
                <h2 className="empty-state__title text-sm font-semibold text-slate-900">
                  No draft matches the filter
                </h2>
                <p className="empty-state__hint mt-1 text-xs text-slate-500">
                  {drafts.length} open{" "}
                  {drafts.length === 1 ? "draft is" : "drafts are"} hidden by it.
                </p>
              </div>
            </div>
          ) : (
            <Masonry
              items={visible}
              itemKey={(d) => d.id}
              render={(d) => (
                <DraftTile
                  draft={d}
                  previews={previewsByDraft.get(d.id) ?? []}
                  onOpen={() => setDetailId(d.id)}
                />
              )}
            />
          )}
        </div>
      </div>

      <RightToolbar storageKey="mm6_drafts_toolbar_open" title="Drafts">
        {(collapsed) =>
          collapsed ? (
            <>
              <button
                type="button"
                onClick={newDraft}
                title="New draft"
                className="drafts-panel__collapsed-icon rounded p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <Plus className="size-5" />
              </button>
            </>
          ) : (
            <div className="drafts-panel flex flex-col gap-3">
              <p className="drafts-panel__hint text-[11px] leading-relaxed text-slate-500">
                A new draft starts with nothing but its MC number. Content,
                brief and cell all arrive later — open the draft and paste the
                deck link on its Brief tab.
              </p>
              <button
                type="button"
                onClick={newDraft}
                className="toolbar-btn toolbar-btn--primary drafts-panel__new flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="size-4" />
                New draft
              </button>
            </div>
          )
        }
      </RightToolbar>

      <MessageEditor
        open={detail !== null}
        message={detail}
        audiences={audiences}
        topics={topicsQ.data ?? []}
        visibleMessages={drafts}
        siblingCount={0}
        onClose={() => setDetailId(null)}
        onJump={setDetailId}
        onPromoted={refresh}
      />
    </div>
  );
}

function DraftTile({
  draft,
  previews,
  onOpen,
}: {
  draft: Draft;
  previews: DraftPreview[];
  onOpen: () => void;
}) {
  // A preview is stale when the row moved on without a re-render; showing the
  // old picture unmarked would be the one thing worse than showing none.
  const fresh = previews.find((p) => p.messageVersion === draft.version);
  const stale = !fresh && previews[0];
  const shown = fresh ?? stale;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="creative-card drafts-tile group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-md"
    >
      <div className="creative-card__thumb drafts-tile__media relative flex min-h-24 items-center justify-center bg-slate-50">
        {shown ? (
          <img
            src={`/api/previews/${shown.id}?v=${encodeURIComponent(shown.updatedAt)}`}
            alt={draft.name ?? mcLabel(draft)}
            className={clsx(
              "drafts-tile__img block w-full",
              !fresh && "opacity-50",
            )}
            loading="lazy"
          />
        ) : (
          <div className="drafts-tile__placeholder p-6 text-center text-[11px] leading-relaxed text-slate-400">
            No content yet —
            <br />
            this draft has only its number.
          </div>
        )}
        {stale && !fresh ? (
          <span className="status-badge drafts-tile__stale absolute right-1.5 top-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            stale preview
          </span>
        ) : null}
      </div>
      <div className="creative-card__meta drafts-tile__meta flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5">
        <span className="creative-card__mc text-xs font-semibold text-slate-900">
          {mcLabel(draft)}
        </span>
        <span className="drafts-tile__name truncate text-[11px] text-slate-500">
          {draft.name || "Untitled"}
        </span>
        {/* The product travels on the card instead of in a group header. It is
            the ONE tag here: the topic chip that used to sit beside it showed
            the draft's working title, which promoting never uses — a leftover
            reading as a fact. It survives where it is true, as the hint under
            the Promote tab's Topic picker. */}
        <span
          className={clsx(
            "tag-chip drafts-tile__product rounded px-1.5 py-0.5 text-[10px]",
            draft.draftProduct
              ? "bg-slate-800 text-white"
              : "border border-dashed border-slate-300 text-slate-400",
          )}
        >
          {draft.draftProduct ?? "no product"}
        </span>
      </div>
    </button>
  );
}
