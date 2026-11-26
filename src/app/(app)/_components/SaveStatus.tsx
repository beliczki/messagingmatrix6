"use client";

// How an autosaving editor shows its save: the small status next to its title
// (save-indicator), and, when a save was refused because someone else saved the
// row first, the bar that offers the only way out: Reload (conflict-bar).
// A conflict is terminal (REBUILD_SPEC §6.3, §8.2): the editor keeps the user's
// edits on screen, sends nothing, and Reload takes the stored row.
import { Icon } from "@/app/_icons/Icon";

export type SaveIndicatorState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "error"; message: string };

export function SaveIndicator({ state }: { state: SaveIndicatorState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <span className="save-indicator save-indicator--saving inline-flex items-center gap-1 text-xs text-slate-500">
        <Icon name="spinner" className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    return (
      <span className="save-indicator save-indicator--saved inline-flex items-center gap-1 text-xs text-emerald-700">
        <Icon name="check" className="size-3" />
        Saved
      </span>
    );
  }
  if (state.kind === "conflict") {
    return (
      <span className="save-indicator save-indicator--conflict inline-flex items-center gap-1 text-xs text-amber-700">
        <Icon name="alert" className="size-3" />
        Conflict — reload needed
      </span>
    );
  }
  return (
    <span
      className="save-indicator save-indicator--error inline-flex items-center gap-1 text-xs text-rose-700"
      title={state.message}
    >
      <Icon name="alert" className="size-3" />
      Save failed
    </span>
  );
}

/** `subject` names the row in the sentence, e.g. "this MC", "this audience". */
export function ConflictBar({ subject, onReload }: { subject: string; onReload: () => void }) {
  return (
    <div className="conflict-bar flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <Icon name="alert" className="conflict-bar__icon size-4 shrink-0" />
      <span className="conflict-bar__msg flex-1">
        Someone else saved changes to {subject} while you had it open. Your
        unsaved edits can&apos;t be applied on top — reload to get the latest
        version. Your changes here will be discarded.
      </span>
      <button
        type="button"
        onClick={onReload}
        className="conflict-bar__btn toolbar-btn--primary rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
      >
        Reload
      </button>
    </div>
  );
}
