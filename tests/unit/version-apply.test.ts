// The Naming tab's "Released version": what a typed value means, and how it
// goes out with the card's own save. The editor serializes every write on one
// If-Match (the committed snapshot's save counter), so the content PATCH and
// the released version go in one save, in a fixed order, never side by side.
import { describe, it, expect } from "vitest";
import {
  parseVersionNo,
  versionApplyRequest,
  versionCommit,
  saveEditorChanges,
} from "@/lib/version-apply";

describe("parseVersionNo", () => {
  it.each([
    ["1", 1],
    ["2", 2],
    [" 12 ", 12],
    // The top of Postgres `integer`, the version_no column's type.
    ["2147483647", 2147483647],
  ])("reads %j as %d", (raw, n) => {
    expect(parseVersionNo(raw)).toBe(n);
  });

  it.each(["", "0", "-1", "1.5", "2e1", "abc", "1a", "2147483648", "99999999999999999999"])(
    "refuses %j",
    (raw) => {
      expect(parseVersionNo(raw)).toBeNull();
    },
  );
});

describe("versionApplyRequest", () => {
  it("posts to the card's version endpoint with the save counter as If-Match", () => {
    const { url, init } = versionApplyRequest({
      id: 42,
      expectedVersion: 10,
      versionNo: 2,
      global: false,
    });
    expect(url).toBe("/api/messages/42/version");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe("10");
    expect(JSON.parse(init.body as string)).toEqual({ versionNo: 2, scope: "local" });
  });

  it("sends scope global when the editor's toggle is on Global", () => {
    const { init } = versionApplyRequest({ id: 42, expectedVersion: 10, versionNo: 3, global: true });
    expect(JSON.parse(init.body as string)).toEqual({ versionNo: 3, scope: "global" });
  });
});

// ── The released version saves with the card (no Apply) ──────────────────
// The Naming tab holds a typed released version as a pending change; it goes
// out with the card's own save (Autosave, or Save when Autosave is off), in
// the same scope as that save (the header's Global/Local toggle).

describe("versionCommit", () => {
  it("turns a new value into a pending released version", () => {
    expect(versionCommit({ raw: "12", current: 11 })).toEqual({ kind: "pending", versionNo: 12 });
  });

  it("allows a lower value: going back to an older version is a choice, not an error", () => {
    expect(versionCommit({ raw: " 3 ", current: 11 })).toEqual({ kind: "pending", versionNo: 3 });
  });

  it("has nothing to save when the value is this copy's released version", () => {
    expect(versionCommit({ raw: "11", current: 11 })).toEqual({ kind: "none" });
  });

  it.each(["", "0", "1.5", "abc", "2147483648"])("refuses %j", (raw) => {
    expect(versionCommit({ raw, current: 11 })).toEqual({ kind: "invalid" });
  });
});

type Row = { id: number; version: number; versionNo: number };

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${init.method} ${url}`);
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      { status: next.status },
    );
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const header = (c: { init: RequestInit }, name: string) =>
  (c.init.headers as Record<string, string>)[name];

describe("saveEditorChanges", () => {
  const base = { id: 7, expectedVersion: 5, global: false };

  it("saves content alone with one PATCH on the save counter", async () => {
    const saved: Row = { id: 7, version: 6, versionNo: 1 };
    const f = fakeFetch([{ status: 200, body: { message: saved } }]);
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: null, fetch: f.fn });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("/api/messages/7");
    expect(f.calls[0].init.method).toBe("PATCH");
    expect(header(f.calls[0], "If-Match")).toBe("5");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ headline: "Új" });
    expect(r).toEqual({ ok: true, written: [{ message: saved, siblings: [] }] });
  });

  it("propagates the content to the audience copies on Global", async () => {
    const saved: Row = { id: 7, version: 6, versionNo: 1 };
    const sib: Row = { id: 9, version: 3, versionNo: 1 };
    const f = fakeFetch([{ status: 200, body: { message: saved, siblings: [sib] } }]);
    const r = await saveEditorChanges<Row>({ ...base, global: true, payload: { headline: "Új" }, versionNo: null, fetch: f.fn });
    expect(f.calls[0].url).toBe("/api/messages/7?propagate=siblings");
    expect(r).toEqual({ ok: true, written: [{ message: saved, siblings: [sib] }] });
  });

  it("never puts the released version in the PATCH body", async () => {
    const f = fakeFetch([
      { status: 200, body: { message: { id: 7, version: 6, versionNo: 1 } } },
      { status: 200, body: { message: { id: 7, version: 7, versionNo: 2 }, siblings: [] } },
    ]);
    await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: 2, fetch: f.fn });
    expect(JSON.parse(f.calls[0].init.body as string)).not.toHaveProperty("versionNo");
  });

  it("saves content first, then the released version on the counter the PATCH returned", async () => {
    const afterPatch: Row = { id: 7, version: 6, versionNo: 1 };
    const afterVersion: Row = { id: 7, version: 7, versionNo: 2 };
    const f = fakeFetch([
      { status: 200, body: { message: afterPatch } },
      { status: 200, body: { message: afterVersion, siblings: [] } },
    ]);
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: 2, fetch: f.fn });
    expect(f.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      "PATCH /api/messages/7",
      "POST /api/messages/7/version",
    ]);
    expect(header(f.calls[1], "If-Match")).toBe("6");
    expect(JSON.parse(f.calls[1].init.body as string)).toEqual({ versionNo: 2, scope: "local" });
    expect(r).toEqual({
      ok: true,
      written: [
        { message: afterPatch, siblings: [] },
        { message: afterVersion, siblings: [] },
      ],
    });
  });

  it("sends only the released version when there is no content change, in the save's scope", async () => {
    const afterVersion: Row = { id: 7, version: 6, versionNo: 4 };
    const f = fakeFetch([{ status: 200, body: { message: afterVersion, siblings: [] } }]);
    const r = await saveEditorChanges<Row>({ ...base, global: true, payload: {}, versionNo: 4, fetch: f.fn });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("/api/messages/7/version");
    expect(header(f.calls[0], "If-Match")).toBe("5");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ versionNo: 4, scope: "global" });
    expect(r).toEqual({ ok: true, written: [{ message: afterVersion, siblings: [] }] });
  });

  it("stops at a content conflict and does not send the released version", async () => {
    const server: Row = { id: 7, version: 8, versionNo: 1 };
    const f = fakeFetch([{ status: 409, body: { error: "version_mismatch", currentRow: server } }]);
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: 2, fetch: f.fn });
    expect(f.calls).toHaveLength(1);
    expect(r).toEqual({ ok: false, written: [], conflict: server });
  });

  it("keeps the saved content when the released version then meets a conflict", async () => {
    const afterPatch: Row = { id: 7, version: 6, versionNo: 1 };
    const server: Row = { id: 7, version: 9, versionNo: 3 };
    const f = fakeFetch([
      { status: 200, body: { message: afterPatch } },
      { status: 409, body: { error: "version_mismatch", currentRow: server } },
    ]);
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: 2, fetch: f.fn });
    expect(r).toEqual({ ok: false, written: [{ message: afterPatch, siblings: [] }], conflict: server });
  });

  it("reports a failed save with the server's text and sends nothing after it", async () => {
    const f = fakeFetch([{ status: 400, body: "bad_field" }]);
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: 2, fetch: f.fn });
    expect(f.calls).toHaveLength(1);
    expect(r).toEqual({ ok: false, written: [], error: "bad_field" });
  });

  it("calls the page's fetch the way the browser allows: not as a method of its options", async () => {
    // window.fetch throws "Illegal invocation" when `this` is some other object.
    const calls: string[] = [];
    const browserFetch = function (this: unknown, url: string) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ message: { id: 7, version: 6, versionNo: 1 } }), { status: 200 }),
      );
    } as unknown as typeof fetch;
    const r = await saveEditorChanges<Row>({ ...base, payload: { headline: "Új" }, versionNo: null, fetch: browserFetch });
    expect(calls).toEqual(["/api/messages/7"]);
    expect(r.ok).toBe(true);
  });

  it("sends nothing when there is nothing to save", async () => {
    const f = fakeFetch([]);
    const r = await saveEditorChanges<Row>({ ...base, payload: {}, versionNo: null, fetch: f.fn });
    expect(f.calls).toHaveLength(0);
    expect(r).toEqual({ ok: true, written: [] });
  });
});
