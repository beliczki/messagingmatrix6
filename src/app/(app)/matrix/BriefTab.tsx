"use client";

// The brief behind a card: which Slides deck the work came in on, WHICH SLIDE
// of it, and a free-text note. Shared by the matrix editor and the drafts
// editor — they are the same component, so a card keeps its brief when a draft
// is promoted rather than the link living on only one of the two surfaces.
//
// The deck and the slide are stored in two different places on purpose. A
// brief is one row per deck per client (`briefs.slides_file_id`, idempotent by
// Drive file id) because several cards share one deck; the SLIDE is per card
// (`messages.brief_slide_id`) because they were each briefed on a different
// page of it. Folding the slide into the brief's identity would split one deck
// into one brief per slide and break the grouping the drafts page is built on.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, ExternalLink } from "lucide-react";
import Field from "./EditorField";
import type { Brief } from "./types";
import { parseSlideAnchor, slidesEmbedUrl, slidesUrl } from "@/lib/slides-link";

// Exactly the fields this tab writes. Declared here rather than imported from
// the editor's EditableFields so the two files don't have to import each other.
export type BriefFields = {
  brief: string | null;
  briefId: number | null;
  briefSlideId: string | null;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function BriefTab({
  draft,
  onChange,
}: {
  draft: BriefFields;
  onChange: (patch: Partial<BriefFields>) => void;
}) {
  const [link, setLink] = useState("");
  const [slideLink, setSlideLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const briefsQ = useQuery({
    queryKey: ["briefs"],
    queryFn: () =>
      fetchJSON<{ briefs: Brief[] }>("/api/briefs").then((d) => d.briefs),
  });
  const briefs = briefsQ.data ?? [];
  const current = briefs.find((b) => b.id === draft.briefId) ?? null;

  // Attaching is an upsert keyed on the Drive file id, so pasting a deck that
  // is already attached selects the existing brief instead of duplicating it.
  const attach = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/briefs", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
      return json.brief as Brief;
    },
    onSuccess: (brief) => {
      setError(null);
      // A deep link pasted into the attach box names a slide as well as a
      // deck; taking both saves the second paste.
      const anchor = parseSlideAnchor(link);
      onChange({
        briefId: brief.id,
        ...(anchor ? { briefSlideId: anchor } : {}),
      });
      setLink("");
      qc.invalidateQueries({ queryKey: ["briefs"] });
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  function applySlideLink(value: string) {
    setSlideLink(value);
    if (!value.trim()) {
      onChange({ briefSlideId: null });
      setError(null);
      return;
    }
    const anchor = parseSlideAnchor(value);
    if (!anchor) {
      setError(
        "no slide in that link — open the slide in Slides and copy the URL from the address bar (it ends in #slide=id.g…)",
      );
      return;
    }
    setError(null);
    onChange({ briefSlideId: anchor });
  }

  const embed = slidesEmbedUrl(current?.slidesFileId, draft.briefSlideId);
  const openUrl = slidesUrl(current?.slidesFileId);

  return (
    <div className="message-editor-tab message-editor-tab--brief">
      <Field
        label="Brief deck"
        hint="One row per deck. Several cards share one brief, which is what groups them on the drafts page."
      >
        <select
          value={draft.briefId ?? ""}
          onChange={(e) =>
            onChange({ briefId: e.target.value ? Number(e.target.value) : null })
          }
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        >
          <option value="">— none —</option>
          {briefs.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label || `Brief ${b.id}`}
            </option>
          ))}
        </select>
      </Field>

      <div className="brief-tab__attach mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="brief-tab__attach-label mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Attach a deck by link
        </div>
        <p className="brief-tab__attach-hint mb-2 text-[10px] leading-relaxed text-slate-400">
          Paste the deck link, or the link to the exact slide — a slide link
          sets both the deck and the slide below in one go. The stored identity
          is the Drive file id, so the editor link and the Drive link are one
          brief rather than two.
        </p>
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://docs.google.com/presentation/d/…"
          className="input-box mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => attach.mutate()}
          disabled={!link.trim() || attach.isPending}
          className="toolbar-btn toolbar-btn--primary flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {attach.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Link2 className="size-3.5" />
          )}
          Attach
        </button>
      </div>

      <Field
        label="Slide"
        hint="Paste the link to the SLIDE this card was briefed on — open it in Slides and copy the URL; it ends in #slide=id.g…. Empty means the deck opens at its first slide."
      >
        <input
          type="url"
          value={slideLink}
          onChange={(e) => applySlideLink(e.target.value)}
          placeholder="https://docs.google.com/presentation/d/…#slide=id.g123abc_0_1"
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>

      {draft.briefSlideId ? (
        <p className="brief-tab__anchor -mt-1 mb-3 font-mono text-[10px] text-slate-500">
          slide {draft.briefSlideId}
        </p>
      ) : null}

      {error ? (
        <p className="form-field__error mb-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {embed ? (
        <div className="brief-tab__preview mb-4">
          <div className="brief-tab__preview-label mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-slate-500">
            <span>Preview</span>
            {openUrl ? (
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 normal-case tracking-normal text-slate-500 hover:text-slate-900"
              >
                <ExternalLink className="size-3" />
                Open in Slides
              </a>
            ) : null}
          </div>
          <iframe
            key={embed}
            src={embed}
            title="Brief slide"
            allowFullScreen
            className="brief-tab__preview-frame aspect-video w-full rounded border border-slate-200 bg-white"
          />
          <p className="brief-tab__preview-note mt-1 text-[10px] text-slate-400">
            Google serves this frame to anyone the deck is shared with. A deck
            shared more narrowly shows a permission notice here instead.
          </p>
        </div>
      ) : (
        <div className="empty-state mb-4 rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400">
          Attach a deck to preview the briefed slide here.
        </div>
      )}

      <Field
        label="Note"
        hint="Free text. What the deck asked for, in your own words."
      >
        <textarea
          value={draft.brief ?? ""}
          onChange={(e) => onChange({ brief: e.target.value || null })}
          rows={5}
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>
    </div>
  );
}
