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
import { CopyPlus, ExternalLink, FilePlus2 } from "lucide-react";
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
  /** "404" — the number the new variant will share. */
  mcNumber: number;
  /**
   * Add a second draft under the same number (MC404a → MC404b). Omitted where
   * the surface cannot navigate to the row it creates.
   */
  onAddVariant?: (mode: "duplicate" | "empty") => void;
  /** True while a variant is being created, so the pair can't be double-fired. */
  variantBusy?: boolean;
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

          <Field
            label="Target"
            hint="What this draft is being made for. DCO renders the template live from the feed; Agentic is delivered files matched by MC number in the Creative Library — and that is what the card and the preview show. Not set yet: the library file is used as soon as one carries this MC number."
          >
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

          {intake.onAddVariant ? (
            <Field
              label="Variants"
              hint={`A second creative under MC${intake.mcNumber}. Duplicate carries this card's copy and images across; empty keeps only the deck, the product and the template, so the wall shows it as still to be written.`}
            >
              <div className="brief-tab__variant flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => intake.onAddVariant?.("duplicate")}
                  disabled={intake.variantBusy}
                  className="toolbar-btn flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <CopyPlus className="size-3.5" />
                  Duplicate as variant
                </button>
                <button
                  type="button"
                  onClick={() => intake.onAddVariant?.("empty")}
                  disabled={intake.variantBusy}
                  className="toolbar-btn flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <FilePlus2 className="size-3.5" />
                  New empty variant
                </button>
              </div>
            </Field>
          ) : null}
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
