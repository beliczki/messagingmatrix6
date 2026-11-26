"use client";

// The edit buffer of an editor that saves one versioned row by itself, 400 ms
// after the last change. The rules it keeps (one save in flight, a response
// only for the editing session that sent it, a 409 is terminal, no resend
// after a failure until something changes, re-seed only on another row) are in
// the pure reducer, src/lib/autosave.ts. This hook only runs its timers and its
// requests, and feeds their outcome back to it.
import { useEffect, useReducer, useRef } from "react";
import {
  autosaveArmed,
  autosaveDirty,
  autosaveInit,
  autosaveReduce,
  type AutosaveEvent,
  type AutosaveRules,
  type AutosaveState,
  type DraftShape,
  type Versioned,
} from "@/lib/autosave";

const DEBOUNCE_MS = 400;
const SAVED_SHOWN_MS = 1500;

type Options<Row extends Versioned, Draft extends DraftShape> = {
  /** Names the row the editor is on; another key starts a new editing session. */
  rowKey: string;
  /** The row as the caller has it now (a list or a query); null until a new row is created. */
  row: Row | null;
  /** The draft of a row that does not exist yet. Read once, when `row` is null at mount. */
  newDraft?: Draft;
  rules: AutosaveRules<Row, Draft>;
  /** Where the save goes: the row's item route, or the collection route for null (POST). */
  url: (row: Row | null) => string;
  /** The stored row out of a 200/201 response body. */
  readSaved: (body: unknown) => Row;
  /**
   * After a save landed, also one of a row the editor has left: refresh the
   * lists that show it. The function as it was when that save was sent.
   */
  onSaved: (row: Row) => void;
  autoSave: boolean;
};

/** The stored row of an editor that always has one (no create): never null. */
export function requireRow<Row>(row: Row | null): Row {
  if (row === null) throw new Error("useVersionedAutosave: this editor always has a stored row");
  return row;
}

type Edit<Draft> = Draft | ((prev: Draft) => Draft);
type HookEvent<Row, Draft> = AutosaveEvent<Row, Draft> | { type: "editWith"; next: Edit<Draft> };

export function useVersionedAutosave<Row extends Versioned, Draft extends DraftShape>(
  o: Options<Row, Draft>,
) {
  const { rules } = o;
  const [s, dispatch] = useReducer(
    (st: AutosaveState<Row, Draft>, e: HookEvent<Row, Draft>) =>
      e.type === "editWith"
        ? autosaveReduce(rules, st, {
            type: "edit",
            draft: typeof e.next === "function" ? (e.next as (p: Draft) => Draft)(st.draft) : e.next,
          })
        : autosaveReduce(rules, st, e),
    null,
    () => {
      if (o.row !== null) return autosaveInit(rules, { key: o.rowKey, row: o.row, autoSave: o.autoSave });
      if (o.newDraft === undefined) {
        throw new Error("useVersionedAutosave: a null row needs newDraft");
      }
      return autosaveInit(rules, { key: o.rowKey, row: null, draft: o.newDraft, autoSave: o.autoSave });
    },
  );

  // The row from the caller. Looked at again whenever the save settles: a peer
  // row that arrived while a save was out is adopted or raised then.
  const { row, rowKey } = o;
  const idleNow = s.status.kind === "idle" && s.inFlight === null;
  useEffect(() => {
    if (row === null) return;
    dispatch({ type: "row", key: rowKey, row });
  }, [row, rowKey, idleNow]);

  useEffect(() => {
    dispatch({ type: "autosave", on: o.autoSave });
  }, [o.autoSave]);

  // Debounce: every change restarts the timer; the reducer checks again when
  // it fires, so a conflict, another row or Autosave off in between sends nothing.
  const armed = autosaveArmed(rules, s);
  useEffect(() => {
    if (!armed) return;
    dispatch({ type: "arm" });
    const t = setTimeout(() => dispatch({ type: "send", manual: false }), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [armed, s.draft, s.session]);

  // The request for the save the reducer put in flight. Not cancelled on
  // unmount or on another row: the write happens on the server either way, and
  // its outcome goes back to the reducer, which takes it only for its session.
  const latest = useRef(o);
  useEffect(() => {
    latest.current = o;
  });
  useEffect(() => {
    const f = s.inFlight;
    if (f === null) return;
    const { url, readSaved, onSaved } = latest.current;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (f.row !== null) headers["If-Match"] = String(f.row.version);
    // Every way this request can end comes back as one outcome. A network
    // error, and also a response it cannot read (a body that is not JSON, a
    // 200 without the saved row), is a failed save: shown, and resent on the
    // next change. Left unhandled, the save would stay in flight for good and
    // no later save could start.
    fetch(url(f.row), {
      method: f.row === null ? "POST" : "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify(f.payload),
    })
      .then(async (r): Promise<AutosaveEvent<Row, Draft>> => {
        if (r.status === 409) {
          const b = (await r.json()) as { currentRow: Row };
          return { type: "conflict", session: f.session, row: b.currentRow };
        }
        if (!r.ok) {
          const text = await r.text();
          return { type: "failed", session: f.session, draft: f.draft, message: text || r.statusText };
        }
        return { type: "saved", session: f.session, row: readSaved(await r.json()) };
      })
      .catch(
        (err: Error): AutosaveEvent<Row, Draft> => ({
          type: "failed",
          session: f.session,
          draft: f.draft,
          message: err.message,
        }),
      )
      .then((outcome) => {
        dispatch(outcome);
        if (outcome.type === "saved") onSaved(outcome.row);
      });
  }, [s.inFlight]);

  useEffect(() => {
    if (s.status.kind !== "saved") return;
    const t = setTimeout(() => dispatch({ type: "settle" }), SAVED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [s.status.kind]);

  return {
    draft: s.draft,
    /** The stored row the draft is compared with; null until a new row is created. */
    committed: s.committed,
    status: s.status,
    dirty: autosaveDirty(rules, s),
    setDraft: (next: Edit<Draft>) => dispatch({ type: "editWith", next }),
    save: () => dispatch({ type: "send", manual: true }),
    cancel: () => dispatch({ type: "cancel" }),
    reload: () => dispatch({ type: "reload" }),
    /** A newer version of this row that another write returned (rekey, …). */
    adopt: (r: Row) => dispatch({ type: "adopt", row: r }),
  };
}
