// Setting an MC's RELEASED VERSION from the editor (REBUILD_SPEC §21):
// version_no, the PMMID's -n_ token. Not the saved version (`version`, the save
// counter) and not a variant. No DOM and no React (the save takes fetch as an
// argument), so the server entity and the client share the scope type and the
// Naming tab's rules are testable without a browser.

// "local" = the open audience copy; "global" = every audience copy of the card
// on its axis (findSiblings). There is no default anywhere: Global reaches
// other rows, so it is always said, never assumed.
export type VersionScope = "local" | "global";

// The top of Postgres `integer`, the type of the version_no column. Above it
// the write fails in the database instead of being refused as a bad value.
export const MAX_VERSION_NO = 2_147_483_647;

/** A released version as typed: a whole number from 1 to MAX_VERSION_NO. Anything else is null. */
export function parseVersionNo(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 && n <= MAX_VERSION_NO ? n : null;
}

// The request that sets the released version: its own endpoint, never a PATCH
// field. If-Match is the saved version (the save counter) it was read on.
export function versionApplyRequest(o: {
  id: number;
  expectedVersion: number;
  versionNo: number;
  global: boolean;
}): { url: string; init: RequestInit } {
  const scope: VersionScope = o.global ? "global" : "local";
  return {
    url: `/api/messages/${o.id}/version`,
    init: {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(o.expectedVersion),
      },
      body: JSON.stringify({ versionNo: o.versionNo, scope }),
    },
  };
}

// ── The released version saves with the card ─────────────────────────────
// No separate Apply: the Naming tab holds a typed released version as a
// pending change, and the card's own save (Autosave, or Save when Autosave is
// off) sends it, in that save's scope (the header's Global/Local toggle).

export type VersionCommit =
  | { kind: "pending"; versionNo: number }
  | { kind: "none" }
  | { kind: "invalid" };

// What a typed released version means once the field is left (blur/Enter).
// The same value as this copy's is nothing to save, on Global too: Global sets
// the copies to the value typed, and a value that was not typed is not sent.
// A lower value is allowed (going back is a choice), and there is no
// automatic bump anywhere.
export function versionCommit(o: { raw: string; current: number }): VersionCommit {
  const n = parseVersionNo(o.raw);
  if (n === null) return { kind: "invalid" };
  if (n === o.current) return { kind: "none" };
  return { kind: "pending", versionNo: n };
}

type Written<Row> = { message: Row; siblings: Row[] };

export type SaveEditorResult<Row> =
  | { ok: true; written: Written<Row>[] }
  | { ok: false; written: Written<Row>[]; conflict: Row }
  | { ok: false; written: Written<Row>[]; error: string };

// One editor save: the content changes first (PATCH, versionNo never in it),
// then the pending released version (its own endpoint) on the save counter the
// PATCH returned. Each step is its own transaction, so a conflict on the
// second leaves the first saved: `written` carries every row that did land, in
// order, and the caller adopts them before entering the conflict state.
export async function saveEditorChanges<Row extends { version: number }>(o: {
  id: number;
  expectedVersion: number;
  payload: Record<string, unknown>;
  versionNo: number | null;
  global: boolean;
  fetch: typeof fetch;
}): Promise<SaveEditorResult<Row>> {
  // Called detached: `o.fetch(...)` would run the browser's fetch with `this`
  // set to `o`, which it refuses ("Illegal invocation").
  const send = o.fetch;
  const written: Written<Row>[] = [];
  let expected = o.expectedVersion;

  if (Object.keys(o.payload).length > 0) {
    const r = await send(
      `/api/messages/${o.id}${o.global ? "?propagate=siblings" : ""}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(expected),
        },
        body: JSON.stringify(o.payload),
      },
    );
    if (r.status === 409) {
      const body = (await r.json()) as { currentRow: Row };
      return { ok: false, written, conflict: body.currentRow };
    }
    if (!r.ok) return { ok: false, written, error: await r.text() };
    const body = (await r.json()) as { message: Row; siblings?: Row[] };
    // A Local PATCH answers without `siblings`; that is "none", not missing data.
    written.push({ message: body.message, siblings: body.siblings ?? [] });
    expected = body.message.version;
  }

  if (o.versionNo !== null) {
    const { url, init } = versionApplyRequest({
      id: o.id,
      expectedVersion: expected,
      versionNo: o.versionNo,
      global: o.global,
    });
    const r = await send(url, init);
    if (r.status === 409) {
      const body = (await r.json()) as { currentRow: Row };
      return { ok: false, written, conflict: body.currentRow };
    }
    if (!r.ok) return { ok: false, written, error: await r.text() };
    const body = (await r.json()) as { message: Row; siblings: Row[] };
    written.push({ message: body.message, siblings: body.siblings });
  }

  return { ok: true, written };
}
