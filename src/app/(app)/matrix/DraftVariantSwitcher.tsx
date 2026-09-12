"use client";

// The variants of ONE draft MC, in the editor header beside the card stepper.
//
// A draft holds a NUMBER, not a number and a letter — how many creatives it
// will end up with is not knowable when the work is taken on. So the drafts
// wall shows one card per MC and the variants live in here, next to the
// `‹ MC404a › 1/5` stepper that already walks between cards: same row of
// controls, one step smaller. Switching is a jump to the sibling row, which the
// editor already does for the stepper — nothing new holds state.
//
// Deliberately NOT a second tab bar (user, 2026-09-10): the tabs are Brief /
// Template / Content / Styles and they are the same tabs the matrix editor
// uses. Folding variants into them would have meant rebuilding that tab
// handling for one surface.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/app/_icons/Icon";
import clsx from "clsx";

export type DraftVariant = { id: number; variant: string };

export default function DraftVariantSwitcher({
  variants,
  ghosts = [],
  activeId,
  onJump,
  onAdd,
  onDeleteActive,
}: {
  /** Every live draft row on this number, ordered by letter. */
  variants: DraftVariant[];
  /**
   * Letters this MC already carries somewhere else — files delivered to the
   * Creative Library under MC404b, say — with no draft row behind them. Shown
   * so the header tells the whole truth about which letters exist, and greyed
   * because there is nothing here to edit.
   */
  ghosts?: string[];
  activeId: number;
  onJump: (id: number) => void;
  onAdd: (mode: "duplicate" | "empty") => Promise<void>;
  /** Hard-delete the variant currently open. Gone for good, number freed only
   *  when it was the last one — the card menu's Delete does the whole MC. */
  onDeleteActive: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // One row of letters, in letter order, whichever side they came from.
  const slots = useMemo(() => {
    const held = new Set(variants.map((v) => v.variant));
    return [
      ...variants.map((v) => ({ kind: "draft" as const, ...v })),
      ...ghosts
        .filter((g) => !held.has(g))
        .map((variant) => ({ kind: "ghost" as const, variant })),
    ].sort((a, b) => a.variant.localeCompare(b.variant));
  }, [variants, ghosts]);

  const activeVariant = variants.find((v) => v.id === activeId)?.variant;

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function add(mode: "duplicate" | "empty") {
    setBusy(true);
    void onAdd(mode).finally(() => {
      setBusy(false);
      setOpen(false);
    });
  }

  return (
    <div
      ref={ref}
      className="draft-variants relative flex items-center gap-1"
      title="Variants of this MC"
    >
      <div className="draft-variants__list tab-bar tab-bar--segmented inline-flex rounded-md border border-slate-300 p-0.5">
        {slots.map((slot) =>
          slot.kind === "draft" ? (
            <button
              key={slot.id}
              type="button"
              onClick={() => onJump(slot.id)}
              className={clsx(
                "draft-variants__item tab-bar__tab rounded px-2 py-0.5 text-xs font-medium uppercase transition",
                slot.id === activeId
                  ? "tab-bar__tab--active bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {slot.variant}
            </button>
          ) : (
            <span
              key={`ghost-${slot.variant}`}
              title={`MC${slot.variant.toUpperCase()} already exists outside this draft — files were delivered to the Creative Library under this letter. There is no draft row to edit.`}
              className="draft-variants__item draft-variants__item--ghost tab-bar__tab rounded border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium uppercase text-slate-300"
            >
              {slot.variant}
            </span>
          ),
        )}
      </div>

      <button
        type="button"
        aria-label="Add a variant"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="draft-variants__add rounded border border-slate-300 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        <Icon name="add" className="size-3.5" />
      </button>

      {/* Delete the variant that is open. Two clicks, and the label says which
          letter is going — the switcher is a row of single characters, and
          "Delete" on its own would not say which one it meant. */}
      <button
        type="button"
        disabled={busy}
        onBlur={() => setConfirming(false)}
        onClick={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          setBusy(true);
          void onDeleteActive().finally(() => {
            setBusy(false);
            setConfirming(false);
          });
        }}
        title={`Delete variant ${activeVariant?.toUpperCase() ?? ""} for good`}
        className={clsx(
          "draft-variants__delete flex items-center gap-1 rounded border p-1 text-xs disabled:opacity-50",
          confirming
            ? "toolbar-btn--danger border-rose-200 px-1.5 font-medium text-rose-700 hover:bg-rose-50"
            : "border-slate-300 text-slate-500 hover:bg-slate-50",
        )}
      >
        <Icon name="delete" className="size-3.5" />
        {confirming ? `Delete ${activeVariant?.toUpperCase() ?? ""}?` : null}
      </button>

      {open ? (
        <div className="dropdown draft-variants__menu absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            disabled={busy}
            onClick={() => add("duplicate")}
            className="draft-variants__menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <Icon name="copy-add" className="size-3.5 shrink-0" />
            Duplicate this variant
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => add("empty")}
            className="draft-variants__menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <Icon name="file-add" className="size-3.5 shrink-0" />
            New empty variant
          </button>
        </div>
      ) : null}
    </div>
  );
}
