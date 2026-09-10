"use client";

// The brief behind a card: WHICH SLIDE it was briefed on, and a free-text note.
// Shared by the matrix editor and the drafts editor, so a card keeps its brief
// when a draft is promoted rather than the link living on only one surface.
//
// ONE field, because a Slides link carries both facts. `parseSlidesFileId`
// takes the deck, `parseSlideAnchor` takes the page — one paste, and the deck
// is identified without ever asking about it. What gets STORED is the file id,
// never the URL, which is what makes "these six cards came from one deck" a
// comparison rather than a string match across three spellings of one link,
// and is what MCP's list_briefs groups open_drafts/promoted by. None of that
// needs a control on this screen: the user picks a slide, the deck follows.
//
// On a DRAFT this tab is also the intake: what the card IS, before anyone has
// decided where it goes. The reserved-number line and the product live here
// (passed in as `intake`, which a placed card simply does not have) because
// they answer the same question the slide does. Promote is left with WHERE.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import clsx from "clsx";
import Field from "./EditorField";
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
  briefSlidesFileId: string | null;
  briefSlideId: string | null;
};

// The three worlds a draft can be made for. This control used to live on the
// Promote tab, where it only chose which audience list to show. It belongs
// here because it decides something earlier and larger: which preview the card
// shows — the HTML render, or the file delivered to the Creative Library — on
// the wall and in this editor, long before anyone promotes anything.
const TARGETS = [
  { key: "dco", label: "DCO" },
  { key: "agentic", label: "Agentic" },
  { key: "both", label: "Both" },
] as const;

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
  /** `draftTarget` from the live edit state. NULL = not decided yet. */
  targetValue: string | null;
  onTargetChange: (target: string) => void;
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

  // The field is seeded from what is stored and then owned by the user until
  // the card changes underneath it (prev/next navigation). The deck's file id
  // is ON the card, so there is nothing to look up — this tab used to fetch
  // the whole briefs list to turn an id back into the string it was parsed
  // from.
  const stored = linkFor(draft.briefSlidesFileId, draft.briefSlideId);
  const [link, setLink] = useState(stored);
  useEffect(() => {
    setLink(stored);
    setError(null);
  }, [stored]);

  // Applied on blur rather than per keystroke: a paste is finished when focus
  // leaves. Attaching used to be its own POST — now it is two fields on the
  // card, saved by the editor like every other edit.
  function apply() {
    const value = link.trim();
    if (value === stored) return;
    if (!value) {
      onChange({ briefSlidesFileId: null, briefSlideId: null });
      setError(null);
      return;
    }
    const fileId = parseSlidesFileId(value);
    if (!fileId) {
      setError(
        /\/folders\//.test(value)
          ? "that is a Drive FOLDER link — paste the link to the slide itself"
          : "no Google Slides link in there — open the slide in Slides and copy the URL from the address bar",
      );
      return;
    }
    setError(null);
    // The FILE ID is what gets stored, never the URL: one deck pasted three
    // ways is one value, which is what makes "these cards share a deck" a
    // comparison rather than a guess.
    onChange({ briefSlidesFileId: fileId, briefSlideId: parseSlideAnchor(value) });
  }

  const embed = slidesEmbedUrl(draft.briefSlidesFileId, draft.briefSlideId);
  const openUrl = linkFor(draft.briefSlidesFileId, draft.briefSlideId);

  return (
    <div className="message-editor-tab message-editor-tab--brief">
      {intake ? (
        <>
          <p className="brief-tab__reserved-note mb-3 text-xs text-slate-500">
            {intake.mcLabel} is already reserved — nothing else can take the
            number. Promoting gives it a cell and keeps the number.
          </p>

          {/* Name and product on one row: the name takes the width, the product
              is a short fixed thing beside it — the same order the drafts card
              reads them in. */}
          <div className="brief-tab__intake-row flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Field label="Draft name">
                <input
                  type="text"
                  value={intake.nameValue ?? ""}
                  onChange={(e) => intake.onNameChange(e.target.value || null)}
                  className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
                />
              </Field>
            </div>
            <div className="w-36 shrink-0">
              <Field label="Product">
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
            </div>
          </div>

          <Field label="Target">
            <div className="brief-tab__target tab-bar tab-bar--segmented inline-flex rounded-md border border-slate-300 p-0.5">
              {TARGETS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => intake.onTargetChange(t.key)}
                  className={clsx(
                    "tab-bar__tab rounded px-3 py-1 text-xs font-medium transition",
                    intake.targetValue === t.key
                      ? "tab-bar__tab--active bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>

        </>
      ) : null}

      {/* No hint under the input (user, 2026-09-10): the placeholder already
          shows the shape of the URL this expects, and the error below says
          exactly what is wrong when a paste misses. */}
      <Field label="Brief slide">
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

      <Field label="Note">
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
