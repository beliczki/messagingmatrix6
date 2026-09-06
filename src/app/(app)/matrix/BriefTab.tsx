"use client";

// The brief behind a card: WHICH SLIDE it was briefed on, and a free-text note.
// Shared by the matrix editor and the drafts editor, so a card keeps its brief
// when a draft is promoted rather than the link living on only one surface.
//
// ONE field, because a Slides link carries both facts. `parseSlidesFileId`
// takes the deck, `parseSlideAnchor` takes the page — one paste, and the deck
// is identified without ever asking about it. That matters because the deck is
// stored as a `briefs` ROW (idempotent on the Drive file id), which is what
// makes "these six cards came from one deck" a fact rather than a string match
// across three spellings of one URL. It is also what MCP's list_briefs counts
// open_drafts/promoted from. None of that needs a control on this screen: the
// user picks a slide, the deck follows.
//
// On a DRAFT this tab is also the intake: what the card IS, before anyone has
// decided where it goes. The reserved-number line and the product live here
// (passed in as `intake`, which a placed card simply does not have) because
// they answer the same question the slide does. Promote is left with WHERE.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ExternalLink } from "lucide-react";
import Field from "./EditorField";
import type { Brief } from "./types";
import {
  parseSlideAnchor,
  parseSlidesFileId,
  slidesEmbedUrl,
  slidesUrl,
} from "@/lib/slides-link";

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

/** The canonical link for what is stored, so the field shows the saved state. */
function linkFor(fileId: string | null, slideId: string | null): string {
  const base = slidesUrl(fileId);
  if (!base) return "";
  return slideId ? `${base}#slide=id.${slideId}` : base;
}

/** The draft-only half of this tab. A placed card passes nothing. */
export type BriefIntake = {
  /** "MC400a" — the number the draft is already holding. */
  mcLabel: string;
  /**
   * `name` from the live edit state. A placed card edits this on its Naming
   * tab; a draft has no Naming tab, so without this the label the drafts page
   * shows on every card was the one field nothing could change.
   */
  nameValue: string | null;
  onNameChange: (name: string | null) => void;
  /** `draftProduct` from the live edit state, so a pick shows immediately. */
  productValue: string | null;
  /** The product vocabulary the dimensions already use. */
  productOptions: string[];
  onProductChange: (product: string | null) => void;
};

export default function BriefTab({
  draft,
  intake,
  onChange,
}: {
  draft: BriefFields;
  intake?: BriefIntake;
  onChange: (patch: Partial<BriefFields>) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  // Read-only lookup: the embed needs the deck's file id, and the row holds
  // only the brief's id. No control is rendered from this.
  const briefsQ = useQuery({
    queryKey: ["briefs"],
    queryFn: () =>
      fetchJSON<{ briefs: Brief[] }>("/api/briefs").then((d) => d.briefs),
  });
  const current =
    (briefsQ.data ?? []).find((b) => b.id === draft.briefId) ?? null;

  // The field is seeded from what is stored and then owned by the user until
  // the card changes underneath it (prev/next navigation).
  const stored = linkFor(current?.slidesFileId ?? null, draft.briefSlideId);
  const [link, setLink] = useState(stored);
  useEffect(() => {
    setLink(stored);
    setError(null);
  }, [stored]);

  // Applied on blur rather than per keystroke: attaching is a write, and a
  // paste is finished when focus leaves.
  async function apply() {
    const value = link.trim();
    if (value === stored) return;
    if (!value) {
      onChange({ briefId: null, briefSlideId: null });
      setError(null);
      return;
    }
    if (!parseSlidesFileId(value)) {
      setError(
        /\/folders\//.test(value)
          ? "that is a Drive FOLDER link — paste the link to the slide itself"
          : "no Google Slides link in there — open the slide in Slides and copy the URL from the address bar",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Idempotent on the file id: the same deck pasted again — or pasted as a
      // Drive link where someone pasted the editor link — lands on one row.
      const r = await fetch("/api/briefs", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link: value }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
      onChange({
        briefId: (json.brief as Brief).id,
        briefSlideId: parseSlideAnchor(value),
      });
      qc.invalidateQueries({ queryKey: ["briefs"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const embed = slidesEmbedUrl(current?.slidesFileId, draft.briefSlideId);
  const openUrl = linkFor(current?.slidesFileId ?? null, draft.briefSlideId);

  return (
    <div className="message-editor-tab message-editor-tab--brief">
      {intake ? (
        <>
          <p className="brief-tab__reserved-note mb-3 text-xs text-slate-500">
            {intake.mcLabel} is already reserved — nothing else can take the
            number. Promoting gives it a cell and keeps the number.
          </p>

          <Field
            label="Draft name"
            hint="Short label shown on the card in the drafts list and, once promoted, in the matrix and feed views."
          >
            <input
              type="text"
              value={intake.nameValue ?? ""}
              onChange={(e) => intake.onNameChange(e.target.value || null)}
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            />
          </Field>

          <Field
            label="Product"
            hint="Tags the draft on the drafts page and drives its Product filter. Once it has a cell the product comes from the cell instead, so this is only needed while it is a draft."
          >
            <select
              value={intake.productValue ?? ""}
              onChange={(e) => intake.onProductChange(e.target.value || null)}
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            >
              <option value="">— not set yet —</option>
              {intake.productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      <Field
        label="Brief slide"
        hint="Open the slide this card was briefed on and paste its URL — the one ending in #slide=id.g…. A plain deck link works too; the preview then opens at the first slide."
      >
        <div className="brief-tab__link-row relative">
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="https://docs.google.com/presentation/d/…#slide=id.g123abc_0_1"
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 pr-7 text-xs focus:border-slate-500 focus:outline-none"
          />
          {busy ? (
            <Loader2 className="brief-tab__spinner absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-slate-400" />
          ) : null}
        </div>
      </Field>

      {error ? (
        <p className="form-field__error mb-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {embed ? (
        <div className="brief-tab__preview mb-4">
          <div className="brief-tab__preview-label mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-slate-500">
            <span>Preview</span>
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 normal-case tracking-normal text-slate-500 hover:text-slate-900"
            >
              <ExternalLink className="size-3" />
              Open in Slides
            </a>
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
          Paste a slide link to preview it here.
        </div>
      )}

      <Field
        label="Note"
        hint="Free text. What the brief asked for, in your own words."
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
