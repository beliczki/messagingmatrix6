// An editor that saves one versioned row by itself: the asset and creative
// dialog, the audience/topic header dialog, a text-formatting rule. Every write
// sends If-Match: <version>, and the server refuses a stale one with 409 and
// the stored row (REBUILD_SPEC §4, §8.2). These are the rules such an editor
// keeps, in one place, so that no editor can keep only some of them:
//
//  R1  One save in flight. Nothing is armed or sent while a save is out; when
//      it settles, whatever was typed meanwhile goes out on the version it
//      returned.
//  R2  A response belongs to the editing session that sent it. Moving to
//      another row starts a new session, so a late response of a row left —
//      also of the same row after A → B → A — touches nothing here.
//  R3  A 409 is terminal. Autosave pauses, the draft stays on screen, and only
//      Reload leaves it: it takes the stored row and sends nothing. Never
//      rebase and resend: that would overwrite the peer's edit (§6.3, §8.2).
//  R4  After a failed save nothing is resent until the draft changes in value
//      (autosaveDue); Save resends it as it is.
//  R5  The draft is re-seeded only by moving to another row. A row from the
//      parent with a newer version is looked at only while idle with nothing
//      in flight (before that it may be the echo of our own save): adopted
//      when the draft is clean, a conflict when it is not. The same or an
//      older version is the echo of our own save, or a stale refetch.
//
// Pure: no React, no fetch. The hook (useVersionedAutosave) runs the timer and
// the request and feeds their outcome back as events.
import { autosaveDue, type SaveAttempt } from "./version-apply";

export type Versioned = { id: number; version: number };
export type DraftShape = Record<string, unknown>;

export type AutosaveRules<Row extends Versioned, Draft extends DraftShape> = {
  toDraft: (row: Row) => Draft;
  /** The content change: the fields of the draft that differ from the stored row. */
  diff: (committed: Row, draft: Draft) => Record<string, unknown>;
  /**
   * For a row that does not exist yet: the body that creates it, or null while
   * the draft cannot be created. Without it, an editor always has a row.
   */
  create?: (draft: Draft) => Record<string, unknown> | null;
};

export type AutosaveStatus<Row, Draft> =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string; failed: SaveAttempt<Draft> }
  | { kind: "conflict"; serverRow: Row };

/** The save that is out: who sent it, against which stored row, with what. */
export type InFlight<Row, Draft> = {
  session: number;
  /** The stored row it was sent against (its URL and If-Match); null when it creates the row. */
  row: Row | null;
  draft: Draft;
  payload: Record<string, unknown>;
};

export type AutosaveState<Row, Draft> = {
  /** Which row the editor is on, as the caller names it (e.g. "audience:12"). */
  key: string;
  /** Counts the rows the editor has been on: a response is taken only by its own session. */
  session: number;
  /** The stored row the draft is compared with; null until a new row is created. */
  committed: Row | null;
  draft: Draft;
  status: AutosaveStatus<Row, Draft>;
  inFlight: InFlight<Row, Draft> | null;
  autoSave: boolean;
};

export type AutosaveEvent<Row, Draft> =
  | { type: "edit"; draft: Draft }
  | { type: "autosave"; on: boolean }
  /** The row as the caller has it now: another row, or a refetch of this one. */
  | { type: "row"; key: string; row: Row }
  /** A save is due and its timer started. */
  | { type: "arm" }
  /** The timer fired (manual: false), or Save was pressed (manual: true). */
  | { type: "send"; manual: boolean }
  | { type: "saved"; session: number; row: Row }
  | { type: "conflict"; session: number; row: Row }
  | { type: "failed"; session: number; draft: Draft; message: string }
  /** "Saved" has been shown long enough. */
  | { type: "settle" }
  | { type: "cancel" }
  | { type: "reload" }
  /** A newer version of this row written by another action (rekey, …). */
  | { type: "adopt"; row: Row };

export function autosaveInit<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  o: { key: string; row: Row; autoSave: boolean } | { key: string; row: null; draft: Draft; autoSave: boolean },
): AutosaveState<Row, Draft> {
  return {
    key: o.key,
    session: 0,
    committed: o.row,
    draft: "draft" in o ? o.draft : rules.toDraft(o.row),
    status: { kind: "idle" },
    inFlight: null,
    autoSave: o.autoSave,
  };
}

// What a save would send now: the change against the stored row, or the body
// that creates the row. Empty when there is nothing to send.
function payloadOf<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  s: AutosaveState<Row, Draft>,
): Record<string, unknown> {
  if (s.committed !== null) return rules.diff(s.committed, s.draft);
  if (!rules.create) {
    throw new Error("autosave: an editor without a stored row needs rules.create");
  }
  return rules.create(s.draft) ?? {};
}

/** Whether the debounced autosave should run now. */
export function autosaveArmed<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  s: AutosaveState<Row, Draft>,
): boolean {
  if (s.inFlight !== null) return false;
  return autosaveDue({
    autoSave: s.autoSave,
    state: s.status.kind,
    failed: s.status.kind === "error" ? s.status.failed : null,
    draft: s.draft,
    payload: payloadOf(rules, s),
    versionNo: null,
  });
}

/** Whether the draft differs from the stored row (or, for a new row, can be created). */
export function autosaveDirty<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  s: AutosaveState<Row, Draft>,
): boolean {
  return Object.keys(payloadOf(rules, s)).length > 0;
}

// "Saving" with nothing in flight means a save is due and its timer runs. When
// the draft is typed back to the stored text, or Autosave is turned off, it is
// no longer due, and the timer that would have sent it sends nothing.
function undue<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  s: AutosaveState<Row, Draft>,
): AutosaveState<Row, Draft> {
  if (s.status.kind !== "saving" || s.inFlight !== null) return s;
  return autosaveArmed(rules, s) ? s : { ...s, status: { kind: "idle" } };
}

export function autosaveReduce<Row extends Versioned, Draft extends DraftShape>(
  rules: AutosaveRules<Row, Draft>,
  s: AutosaveState<Row, Draft>,
  e: AutosaveEvent<Row, Draft>,
): AutosaveState<Row, Draft> {
  switch (e.type) {
    case "edit":
      return undue(rules, { ...s, draft: e.draft });

    case "autosave":
      if (e.on === s.autoSave) return s;
      return undue(rules, { ...s, autoSave: e.on });

    case "row": {
      if (e.key !== s.key) {
        // Another row: a new editing session. A save still out for the row
        // left stays in flight (R1) and is ignored when it lands (R2).
        return {
          ...s,
          key: e.key,
          session: s.session + 1,
          committed: e.row,
          draft: rules.toDraft(e.row),
          status: { kind: "idle" },
        };
      }
      if (s.inFlight !== null || s.status.kind !== "idle") return s;
      if (s.committed === null) return s;
      if (e.row.version <= s.committed.version) return s;
      if (Object.keys(rules.diff(s.committed, s.draft)).length === 0) {
        return { ...s, committed: e.row, draft: rules.toDraft(e.row) };
      }
      return { ...s, status: { kind: "conflict", serverRow: e.row } };
    }

    case "arm":
      if (!autosaveArmed(rules, s) || s.status.kind === "saving") return s;
      return { ...s, status: { kind: "saving" } };

    case "send": {
      if (s.inFlight !== null || s.status.kind === "conflict") return s;
      if (!e.manual && !autosaveArmed(rules, s)) return s;
      const payload = payloadOf(rules, s);
      if (Object.keys(payload).length === 0) return s;
      return {
        ...s,
        inFlight: { session: s.session, row: s.committed, draft: s.draft, payload },
        status: { kind: "saving" },
      };
    }

    case "saved":
      if (e.session !== s.session) return { ...s, inFlight: null };
      return { ...s, inFlight: null, committed: e.row, status: { kind: "saved" } };

    case "conflict":
      if (e.session !== s.session) return { ...s, inFlight: null };
      return { ...s, inFlight: null, status: { kind: "conflict", serverRow: e.row } };

    case "failed":
      if (e.session !== s.session) return { ...s, inFlight: null };
      return {
        ...s,
        inFlight: null,
        status: { kind: "error", message: e.message, failed: { draft: e.draft, versionNo: null } },
      };

    case "settle":
      return s.status.kind === "saved" ? { ...s, status: { kind: "idle" } } : s;

    case "cancel":
      if (s.status.kind === "conflict" || s.committed === null) return s;
      return { ...s, draft: rules.toDraft(s.committed), status: { kind: "idle" } };

    case "reload":
      if (s.status.kind !== "conflict") return s;
      return {
        ...s,
        committed: s.status.serverRow,
        draft: rules.toDraft(s.status.serverRow),
        status: { kind: "idle" },
      };

    case "adopt":
      if (s.status.kind === "conflict" || s.committed === null) return s;
      if (e.row.id !== s.committed.id || e.row.version <= s.committed.version) return s;
      return undue(rules, { ...s, committed: e.row });
  }
}
