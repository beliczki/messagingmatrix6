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
import { useEffect, useRef, useState } from "react";
import { CopyPlus, FilePlus2, Plus } from "lucide-react";
import clsx from "clsx";

export type DraftVariant = { id: number; variant: string };

export default function DraftVariantSwitcher({
  variants,
  activeId,
  onJump,
  onAdd,
}: {
  /** Every live draft row on this number, ordered by letter. */
  variants: DraftVariant[];
  activeId: number;
  onJump: (id: number) => void;
  onAdd: (mode: "duplicate" | "empty") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        {variants.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => onJump(v.id)}
            className={clsx(
              "draft-variants__item tab-bar__tab rounded px-2 py-0.5 text-xs font-medium uppercase transition",
              v.id === activeId
                ? "tab-bar__tab--active bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            {v.variant}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-label="Add a variant"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="draft-variants__add rounded border border-slate-300 p-1 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        <Plus className="size-3.5" />
      </button>

      {open ? (
        <div className="dropdown draft-variants__menu absolute left-0 top-full z-50 mt-1 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            disabled={busy}
            onClick={() => add("duplicate")}
            className="draft-variants__menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <CopyPlus className="size-3.5 shrink-0" />
            Duplicate this variant
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => add("empty")}
            className="draft-variants__menu-item flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <FilePlus2 className="size-3.5 shrink-0" />
            New empty variant
          </button>
        </div>
      ) : null}
    </div>
  );
}
