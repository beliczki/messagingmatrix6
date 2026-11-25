// Setting an MC's VERSION from the editor (REBUILD_SPEC §21): version_no, the
// PMMID's -n_ token. Pure, so the server entity and the client both use the
// same scope type and the Naming tab's rules are testable without a DOM.

// "local" = the open audience copy; "global" = every audience copy of the card
// on its axis (findSiblings). There is no default anywhere: Global reaches
// other rows, so it is always said, never assumed.
export type VersionScope = "local" | "global";

/** A version as typed: a whole number, 1 or more. Anything else is null. */
export function parseVersionNo(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
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
export function versionApplyBlock(s: {
  raw: string;
  current: number;
  isDirty: boolean;
  busy: boolean;
  conflict: boolean;
}): VersionApplyBlock | null {
  if (s.conflict) return "conflict";
  if (s.busy) return "busy";
  if (s.isDirty) return "unsaved";
  const n = parseVersionNo(s.raw);
  if (n === null) return "invalid";
  if (n === s.current) return "unchanged";
  return null;
}

export const VERSION_APPLY_BLOCK_TEXT: Record<VersionApplyBlock, string> = {
  conflict: "Reload the card first",
  busy: "Saving…",
  unsaved: "Save your edits first",
  invalid: "A version is a whole number, 1 or more",
  unchanged: "This is the current version",
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
