// Setting an MC's RELEASED VERSION from the editor (REBUILD_SPEC §21):
// version_no, the PMMID's -n_ token. Not the saved version (`version`, the save
// counter) and not a variant. Pure, so the server entity and the client both use the
// same scope type and the Naming tab's rules are testable without a DOM.

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

export type VersionApplyBlock =
  | "conflict"
  | "busy"
  | "unsaved"
  | "invalid"
  | "unchanged";

// Why Apply cannot fire right now, or null when it can. Every editor write
// carries the committed snapshot's save counter as If-Match, so Apply waits
// for pending edits (they save first and are not lost) and for any write in
// flight, rather than racing them on the same If-Match.
//
// "unchanged" is a Local answer only: `current` is the open copy's value, and
// on Global the other copies may stand on another one, which Apply then
// brings in line (the server leaves the copies already there alone).
export function versionApplyBlock(s: {
  raw: string;
  current: number;
  global: boolean;
  isDirty: boolean;
  busy: boolean;
  conflict: boolean;
}): VersionApplyBlock | null {
  if (s.conflict) return "conflict";
  if (s.busy) return "busy";
  if (s.isDirty) return "unsaved";
  const n = parseVersionNo(s.raw);
  if (n === null) return "invalid";
  if (!s.global && n === s.current) return "unchanged";
  return null;
}

export const VERSION_APPLY_BLOCK_TEXT: Record<VersionApplyBlock, string> = {
  conflict: "Reload the card first",
  busy: "Saving…",
  unsaved: "Save your edits first",
  invalid: "A released version is a whole number, 1 or more",
  unchanged: "This copy already has this released version",
};

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
