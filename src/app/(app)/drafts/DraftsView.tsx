"use client";

// The drafts surface: work that has been taken on and has claimed its MC
// number, but has not been placed in the matrix yet. A draft is a `messages`
// row with no audience, so everything here — previews, versioning, editing —
// runs on the ordinary message machinery; what makes it a draft is the missing
// cell, and promoting is what fills it in.
//
// Grouped by BRIEF, because the question this page answers is "what came of
// this deck?" — the promote counts on each group header are the cheap version
// of a close check: both numbers are counted from the work itself, so there is
// no separate state to drift.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  FlaskConical,
  Link2,
  Loader2,
  Plus,
  ArrowUpRight,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import RightToolbar from "../_components/RightToolbar";
import AppDialog from "../_components/AppDialog";
import DraftDetailDialog from "./DraftDetailDialog";
import type { Draft, DraftPreview, BriefRow } from "./types";

const UNBRIEFED = -1;

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
  const [attachOpen, setAttachOpen] = useState(false);
  const qc = useQueryClient();

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
  const briefs = useMemo(() => data?.briefs ?? [], [data]);

  const previewsByDraft = useMemo(() => {
    const m = new Map<number, DraftPreview[]>();
    for (const p of previews) {
      const list = m.get(p.messageId) ?? [];
      list.push(p);
      m.set(p.messageId, list);
    }
    return m;
  }, [previews]);

  // Brief groups in the briefs' own order (newest first), with the unbriefed
  // drafts last — they are the ones still missing their reason for existing.
  const groups = useMemo(() => {
    const byBrief = new Map<number, Draft[]>();
    for (const d of drafts) {
      const key = d.briefId ?? UNBRIEFED;
      const list = byBrief.get(key) ?? [];
      list.push(d);
      byBrief.set(key, list);
    }
    const out: Array<{ brief: BriefRow | null; drafts: Draft[] }> = [];
    for (const b of briefs) {
      const list = byBrief.get(b.id);
      // A brief with no open drafts still belongs on the page when something
      // was promoted out of it — that IS the answer to "what came of it".
      if (list || b.promoted > 0) out.push({ brief: b, drafts: list ?? [] });
    }
    const loose = byBrief.get(UNBRIEFED);
    if (loose) out.push({ brief: null, drafts: loose });
    return out;
  }, [drafts, briefs]);

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
          <div className="toolbar__count ml-auto text-[11px] text-slate-500">
            {drafts.length} open · {briefs.length} brief
            {briefs.length === 1 ? "" : "s"}
          </div>
        </div>

        <div className="drafts-view__scroll flex-1 overflow-auto p-4">
          {draftsQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="empty-state drafts-view__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                <FlaskConical className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
                <h2 className="empty-state__title text-sm font-semibold text-slate-900">
                  Nothing in progress
                </h2>
                <p className="empty-state__hint mt-1 text-xs text-slate-500">
                  A draft claims its MC number the moment work is taken on, so
                  the number stops moving before the card reaches the matrix.
                  Start one from the toolbar, or attach the brief it came in on.
                </p>
              </div>
            </div>
          ) : (
            <div className="drafts-view__groups flex flex-col gap-6">
              {groups.map((g) => (
                <BriefGroup
                  key={g.brief?.id ?? UNBRIEFED}
                  brief={g.brief}
                  drafts={g.drafts}
                  previewsByDraft={previewsByDraft}
                  onOpen={setDetailId}
                />
              ))}
            </div>
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
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                title="Attach a brief"
                className="drafts-panel__collapsed-icon rounded p-1.5 text-slate-500 hover:bg-slate-100"
              >
                <Link2 className="size-5" />
              </button>
            </>
          ) : (
            <div className="drafts-panel flex flex-col gap-3">
              <p className="drafts-panel__hint text-[11px] leading-relaxed text-slate-500">
                A new draft starts with nothing but its MC number. Content,
                brief and cell can all arrive later.
              </p>
              <button
                type="button"
                onClick={newDraft}
                className="toolbar-btn toolbar-btn--primary drafts-panel__new flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="size-4" />
                New draft
              </button>
              <button
                type="button"
                onClick={() => setAttachOpen(true)}
                className="toolbar-btn drafts-panel__attach flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Link2 className="size-4" />
                Attach a brief
              </button>
            </div>
          )
        }
      </RightToolbar>

      {attachOpen ? (
        <AttachBriefDialog
          onClose={() => setAttachOpen(false)}
          onAttached={() => {
            setAttachOpen(false);
            refresh();
          }}
        />
      ) : null}

      {detail ? (
        <DraftDetailDialog
          draft={detail}
          previews={previewsByDraft.get(detail.id) ?? []}
          briefs={briefs}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

function BriefGroup({
  brief,
  drafts,
  previewsByDraft,
  onOpen,
}: {
  brief: BriefRow | null;
  drafts: Draft[];
  previewsByDraft: Map<number, DraftPreview[]>;
  onOpen: (id: number) => void;
}) {
  return (
    <section className="brief-group">
      <header className="brief-group__header mb-2 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-1.5">
        <FileText className="brief-group__icon size-3.5 text-slate-400" />
        {brief ? (
          <a
            href={`https://docs.google.com/presentation/d/${brief.slidesFileId}/edit`}
            target="_blank"
            rel="noreferrer"
            className="brief-group__title text-xs font-semibold uppercase tracking-wider text-slate-700 hover:text-slate-900 hover:underline"
          >
            {brief.label || "Untitled brief"}
          </a>
        ) : (
          <span className="brief-group__title text-xs font-semibold uppercase tracking-wider text-slate-400">
            No brief yet
          </span>
        )}
        {brief ? (
          <span className="brief-group__progress text-[10px] text-slate-500">
            {brief.openDrafts} open · {brief.promoted} promoted
          </span>
        ) : null}
      </header>
      {drafts.length === 0 ? (
        <p className="brief-group__empty text-[11px] text-slate-400">
          Everything from this brief is in the matrix.
        </p>
      ) : (
        <Masonry
          items={drafts}
          itemKey={(d) => d.id}
          render={(d) => (
            <DraftTile
              draft={d}
              previews={previewsByDraft.get(d.id) ?? []}
              onOpen={() => onOpen(d.id)}
            />
          )}
        />
      )}
    </section>
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
        {draft.topic ? (
          <span className="tag-chip drafts-tile__topic rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {draft.topic}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function AttachBriefDialog({
  onClose,
  onAttached,
}: {
  onClose: () => void;
  onAttached: () => void;
}) {
  const [link, setLink] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postJSON("/api/briefs", { link, label: label || null });
      onAttached();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppDialog open onClose={onClose} ariaLabel="Attach a brief">
      <div className="modal__header border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Attach a brief</h2>
        <p className="mt-1 text-xs text-slate-500">
          Paste the link to the deck the work came in on. The file id is what
          gets stored, so the editor link and the Drive link are one brief.
        </p>
      </div>
      <div className="modal__body flex-1 overflow-y-auto px-5 py-4">
        <div className="form-field mb-3">
          <label className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Link
          </label>
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/presentation/d/…"
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
        </div>
        <div className="form-field">
          <label className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Label (optional)
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="What this brief is about"
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
          />
        </div>
        {error ? (
          <p className="form-field__error mt-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
      </div>
      <div className="modal__footer flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="toolbar-btn rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !link.trim()}
          className="toolbar-btn toolbar-btn--primary flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowUpRight className="size-3.5" />
          )}
          Attach
        </button>
      </div>
    </AppDialog>
  );
}
