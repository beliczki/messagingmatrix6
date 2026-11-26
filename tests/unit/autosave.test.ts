// The rules every autosaving editor of one versioned row follows (REBUILD_SPEC
// §6.3, §8.2): one save in flight; a response is taken only by the editing
// session that sent it; a 409 is terminal and only Reload leaves it; after a
// failure nothing is resent until something changes; the edit buffer is
// re-seeded only by moving to another row, never by the echo of its own save.
// Expected values come from those rules, not from the implementation.
import { describe, expect, it } from "vitest";
import {
  autosaveArmed,
  autosaveInit,
  autosaveReduce,
  type AutosaveEvent,
  type AutosaveRules,
  type AutosaveState,
} from "@/lib/autosave";

type Row = { id: number; version: number; text: string; n: number };
type Draft = { text: string; n: number };
type S = AutosaveState<Row, Draft>;
type E = AutosaveEvent<Row, Draft>;

const rules: AutosaveRules<Row, Draft> = {
  toDraft: (r) => ({ text: r.text, n: r.n }),
  diff: (c, d) => {
    const out: Record<string, unknown> = {};
    if (c.text !== d.text) out.text = d.text;
    if (c.n !== d.n) out.n = d.n;
    return out;
  },
};
// A row that does not exist yet: the first save creates it (POST).
const creating: AutosaveRules<Row, Draft> = {
  ...rules,
  create: (d) => (d.text.length > 0 ? { text: d.text, n: d.n } : null),
};

const row = (over: Partial<Row> = {}): Row => ({ id: 1, version: 1, text: "a", n: 0, ...over });

const run = (state: S, ...events: E[]) => events.reduce((s, e) => autosaveReduce(rules, s, e), state);
const runC = (state: S, ...events: E[]) => events.reduce((s, e) => autosaveReduce(creating, s, e), state);

const start = () => autosaveInit(rules, { key: "1", row: row(), autoSave: true });
const edit = (text: string, n = 0): E => ({ type: "edit", draft: { text, n } });
const send: E = { type: "send", manual: false };
const save: E = { type: "send", manual: true };
// The response to the save in flight, for the editing session that sent it.
const saved = (s: S, r: Row): E => ({ type: "saved", session: s.inFlight!.session, row: r });
const conflict = (s: S, r: Row): E => ({ type: "conflict", session: s.inFlight!.session, row: r });
const failed = (s: S, message: string): E => ({
  type: "failed",
  session: s.inFlight!.session,
  draft: s.inFlight!.draft,
  message,
});

describe("autosave: a save", () => {
  it("is armed after an edit, and sends the change on the stored row", () => {
    const s = run(start(), edit("ab"));
    expect(autosaveArmed(rules, s)).toBe(true);
    const sent = run(s, send);
    expect(sent.inFlight).toEqual({
      session: s.session,
      row: row(),
      draft: { text: "ab", n: 0 },
      payload: { text: "ab" },
    });
    expect(sent.status.kind).toBe("saving");
  });

  it("is not armed with nothing to save, and a save with nothing to save sends nothing", () => {
    expect(autosaveArmed(rules, start())).toBe(false);
    expect(run(start(), save).inFlight).toBeNull();
  });

  it("is not armed, and a timer does not send, with Autosave off; Save still sends", () => {
    const s = run(start(), { type: "autosave", on: false }, edit("ab"));
    expect(autosaveArmed(rules, s)).toBe(false);
    expect(run(s, send).inFlight).toBeNull();
    expect(run(s, save).inFlight?.payload).toEqual({ text: "ab" });
  });

  it("a due save typed back to the stored text is no longer due: it does not stay 'saving'", () => {
    const due = run(start(), edit("ab"), { type: "arm" });
    expect(due.status.kind).toBe("saving");
    expect(run(due, edit("a")).status.kind).toBe("idle");
    expect(run(due, { type: "autosave", on: false }).status.kind).toBe("idle");
    // Still due after a further edit: it stays armed.
    expect(run(due, edit("abc")).status.kind).toBe("saving");
  });
});

describe("autosave: one save in flight (R1)", () => {
  it("does not arm or send a second save while one is in flight", () => {
    const s = run(start(), edit("ab"), send, edit("abc"));
    expect(autosaveArmed(rules, s)).toBe(false);
    expect(run(s, send).inFlight?.draft).toEqual({ text: "ab", n: 0 });
    expect(run(s, save).inFlight?.draft).toEqual({ text: "ab", n: 0 });
  });

  it("keeps what was typed meanwhile and sends it on the row the save returned", () => {
    const flying = run(start(), edit("ab"), send, edit("abc"));
    const s = run(flying, saved(flying, row({ text: "ab", version: 2 })));
    expect(s.draft).toEqual({ text: "abc", n: 0 });
    expect(s.committed).toEqual(row({ text: "ab", version: 2 }));
    expect(s.inFlight).toBeNull();
    expect(autosaveArmed(rules, s)).toBe(true);
    const next = run(s, send).inFlight!;
    expect(next.payload).toEqual({ text: "abc" });
    expect(next.row?.version).toBe(2);
  });

  it("on another row, waits until the save of the row left settles", () => {
    const flying = run(start(), edit("ab"), send);
    const s = run(flying, { type: "row", key: "2", row: row({ id: 2, text: "b" }) }, edit("bc"));
    expect(autosaveArmed(rules, s)).toBe(false);
    const settled = run(s, saved(flying, row({ text: "ab", version: 2 })));
    expect(autosaveArmed(rules, settled)).toBe(true);
    expect(run(settled, send).inFlight).toMatchObject({ session: settled.session, payload: { text: "bc" } });
  });
});

describe("autosave: the row as the parent has it (R5)", () => {
  it("ignores the echo of its own save: the same version, or an older one", () => {
    const flying = run(start(), edit("ab"), send, edit("abc"));
    const done = run(flying, saved(flying, row({ text: "ab", version: 2 })));
    for (const s of [done, run(done, { type: "settle" })]) {
      expect(run(s, { type: "row", key: "1", row: row({ text: "ab", version: 2 }) }).draft.text).toBe("abc");
      expect(run(s, { type: "row", key: "1", row: row({ text: "a", version: 1 }) }).draft.text).toBe("abc");
    }
  });

  it("ignores a newer row while its save is in flight: it may be the echo of that save", () => {
    const s = run(start(), edit("ab"), send, { type: "row", key: "1", row: row({ text: "ab", version: 2 }) });
    expect(s.status.kind).toBe("saving");
    expect(s.committed?.version).toBe(1);
  });

  it("adopts a newer row from a peer when clean and idle, and sends nothing", () => {
    const s = run(start(), { type: "row", key: "1", row: row({ text: "peer", version: 3 }) });
    expect(s.committed).toEqual(row({ text: "peer", version: 3 }));
    expect(s.draft.text).toBe("peer");
    expect(autosaveArmed(rules, s)).toBe(false);
  });

  it("turns a newer row from a peer into a conflict when there are unsaved edits", () => {
    // Autosave off: the edit waits for Save, so the editor is idle and dirty.
    const s = run(start(), { type: "autosave", on: false }, edit("mine"), {
      type: "row",
      key: "1",
      row: row({ text: "peer", version: 3 }),
    });
    expect(s.status).toEqual({ kind: "conflict", serverRow: row({ text: "peer", version: 3 }) });
    expect(s.draft.text).toBe("mine");
  });

  it("ignores a newer row while a save is due or has failed", () => {
    const due = run(start(), edit("ab"), { type: "arm" });
    expect(run(due, { type: "row", key: "1", row: row({ version: 3 }) }).status.kind).toBe("saving");
    const flying = run(start(), edit("ab"), send);
    const down = run(flying, failed(flying, "boom"));
    expect(run(down, { type: "row", key: "1", row: row({ version: 3 }) }).status.kind).toBe("error");
  });

  it("re-seeds from another row, in a new editing session", () => {
    const before = run(start(), edit("ab"));
    const s = run(before, { type: "row", key: "2", row: row({ id: 2, text: "b", version: 4 }) });
    expect(s.key).toBe("2");
    expect(s.session).not.toBe(before.session);
    expect(s.committed).toEqual(row({ id: 2, text: "b", version: 4 }));
    expect(s.draft).toEqual({ text: "b", n: 0 });
    expect(s.status.kind).toBe("idle");
  });
});

describe("autosave: a response for an editing session already left (R2)", () => {
  const flying = () => run(start(), edit("ab"), send);
  const away = (f: S) => run(f, { type: "row", key: "2", row: row({ id: 2, text: "b" }) });

  it("a saved row of the row left does not become this row's stored row", () => {
    const f = flying();
    const s = run(away(f), saved(f, row({ text: "ab", version: 2 })));
    expect(s.committed).toEqual(row({ id: 2, text: "b" }));
    expect(s.draft).toEqual({ text: "b", n: 0 });
    expect(s.inFlight).toBeNull();
    expect(autosaveArmed(rules, s)).toBe(false);
  });

  it("a conflict or a failure of the row left is not shown here", () => {
    const f = flying();
    expect(run(away(f), conflict(f, row({ version: 9 }))).status.kind).toBe("idle");
    expect(run(away(f), failed(f, "boom")).status.kind).toBe("idle");
  });

  it("after A → B → A, the old save of A is not taken by the new session on A", () => {
    const f = flying();
    // Back on A: re-seeded from the parent's list, which still has version 1.
    const back = run(away(f), { type: "row", key: "1", row: row() });
    const s = run(back, saved(f, row({ text: "ab", version: 2 })));
    expect(s.committed).toEqual(row());
    expect(s.draft).toEqual({ text: "a", n: 0 });
    expect(autosaveArmed(rules, s)).toBe(false);
  });
});

describe("autosave: a conflict is terminal (R3)", () => {
  const conflicted = () => {
    const f = run(start(), edit("ab"), send);
    return run(f, conflict(f, row({ text: "peer", version: 5 })));
  };

  it("keeps the draft, and neither autosave, Save, Cancel nor adopt leaves it", () => {
    const s = run(conflicted(), edit("abc"));
    expect(s.draft.text).toBe("abc");
    expect(autosaveArmed(rules, s)).toBe(false);
    expect(run(s, send).inFlight).toBeNull();
    expect(run(s, save).inFlight).toBeNull();
    expect(run(s, { type: "cancel" }).status.kind).toBe("conflict");
    const adopted = run(s, { type: "adopt", row: row({ version: 6 }) });
    expect(adopted.status.kind).toBe("conflict");
    expect(adopted.committed?.version).toBe(1);
  });

  it("Reload takes the stored row and sends nothing until the next edit", () => {
    const s = run(conflicted(), { type: "reload" });
    expect(s.status.kind).toBe("idle");
    expect(s.committed).toEqual(row({ text: "peer", version: 5 }));
    expect(s.draft).toEqual({ text: "peer", n: 0 });
    expect(autosaveArmed(rules, s)).toBe(false);
    const next = run(s, edit("peer!"), send).inFlight!;
    expect(next.payload).toEqual({ text: "peer!" });
    expect(next.row?.version).toBe(5);
  });
});

describe("autosave: after a failure (R4)", () => {
  const down = () => {
    const f = run(start(), edit("ab"), send);
    return run(f, failed(f, "boom"));
  };

  it("holds the failed save and does not resend it", () => {
    const s = down();
    expect(s.status).toEqual({
      kind: "error",
      message: "boom",
      failed: { draft: { text: "ab", n: 0 }, versionNo: null },
    });
    expect(autosaveArmed(rules, s)).toBe(false);
    expect(run(s, send).inFlight).toBeNull();
  });

  it("an equal draft built anew is not a change", () => {
    expect(autosaveArmed(rules, run(down(), edit("ab")))).toBe(false);
  });

  it("resends after a change, and Save resends it as it is", () => {
    expect(autosaveArmed(rules, run(down(), edit("abc")))).toBe(true);
    expect(run(down(), save).inFlight?.payload).toEqual({ text: "ab" });
  });
});

describe("autosave: a row that does not exist yet", () => {
  const blank = () => autosaveInit(creating, { key: "d1", row: null, draft: { text: "", n: 0 }, autoSave: true });

  it("waits until the draft can be created, then creates it", () => {
    expect(autosaveArmed(creating, blank())).toBe(false);
    const s = runC(blank(), edit("x"));
    expect(autosaveArmed(creating, s)).toBe(true);
    expect(runC(s, send).inFlight).toEqual({
      session: s.session,
      row: null,
      draft: { text: "x", n: 0 },
      payload: { text: "x", n: 0 },
    });
  });

  it("takes the created row, keeps what was typed meanwhile, and saves that onto it", () => {
    const flying = runC(blank(), edit("x"), send, edit("xy"));
    const s = runC(flying, saved(flying, row({ id: 9, text: "x", version: 1 })));
    expect(s.committed).toEqual(row({ id: 9, text: "x", version: 1 }));
    expect(s.draft.text).toBe("xy");
    const next = runC(s, send).inFlight!;
    expect(next.row?.id).toBe(9);
    expect(next.payload).toEqual({ text: "xy" });
  });

  it("does not create a second row while the first create is in flight", () => {
    const s = runC(blank(), edit("x"), send, edit("xy"));
    expect(autosaveArmed(creating, s)).toBe(false);
    expect(runC(s, send).inFlight?.draft.text).toBe("x");
  });

  it("the created row arriving from the list is its own echo", () => {
    const flying = runC(blank(), edit("x"), send, edit("xy"));
    const s = runC(
      flying,
      { type: "row", key: "d1", row: row({ id: 9, text: "x", version: 1 }) },
      saved(flying, row({ id: 9, text: "x", version: 1 })),
      { type: "row", key: "d1", row: row({ id: 9, text: "x", version: 1 }) },
    );
    expect(s.draft.text).toBe("xy");
    expect(s.status.kind).toBe("saved");
  });
});

describe("autosave: the rest", () => {
  it("Cancel puts the draft back to the stored row", () => {
    const s = run(start(), edit("ab"), { type: "cancel" });
    expect(s.draft).toEqual({ text: "a", n: 0 });
    expect(s.status.kind).toBe("idle");
  });

  it("a newer row written elsewhere (adopt) becomes the stored row and keeps the draft", () => {
    const s = run(start(), edit("ab"), { type: "adopt", row: row({ version: 2, n: 7 }) });
    expect(s.committed).toEqual(row({ version: 2, n: 7 }));
    expect(s.draft).toEqual({ text: "ab", n: 0 });
    expect(run(s, { type: "adopt", row: row({ version: 1 }) }).committed?.version).toBe(2);
    expect(run(s, { type: "adopt", row: row({ id: 2, version: 9 }) }).committed?.id).toBe(1);
  });

  it("a due save is no longer due when the adopted row already holds the draft", () => {
    const s = run(start(), edit("ab"), { type: "arm" }, { type: "adopt", row: row({ version: 2, text: "ab" }) });
    expect(autosaveArmed(rules, s)).toBe(false);
    expect(s.status.kind).toBe("idle");
  });

  it("'saved' turns idle once it has been shown, and nothing else does", () => {
    const f = run(start(), edit("ab"), send);
    expect(run(f, saved(f, row({ text: "ab", version: 2 })), { type: "settle" }).status.kind).toBe("idle");
    expect(run(f, failed(f, "x"), { type: "settle" }).status.kind).toBe("error");
  });
});
