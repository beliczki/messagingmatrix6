// The MC lifecycle, in ONE place.
//
// It used to be spelled out separately in the matrix filter, the editor
// dropdown, the Design tab, the template editor, the branding CSS vars and the
// DB defaults — six lists that had to agree and did not. `PLANNED` reached
// production through the filter while the Design tab never heard of it, and
// because an unknown status matches no filter option, those eight cards were
// invisible in every status-scoped view. Pure constants (no `db` import) so
// client and server can both read them, following keywords-shared.ts.
//
//   DRAFT → PREVIEW → APPROVED → ACTIVE → INACTIVE        (+ DEAD)
//
// DRAFT: taken on, MC number claimed, no cell yet — outside the matrix.
// PREVIEW: in a cell, rendered, waiting for sign-off. The BIRTH status of a
//   matrix card: by the time an MC is placed, the template and the content are
//   there, so starting anywhere earlier only ever meant a manual click.
// APPROVED: signed off on the share gallery. Still movable, so this is also the
//   last stop before measurement starts.
// ACTIVE / INACTIVE: measured. The PMMID anchors reporting from here on, which
//   is why both are placement-locked.
// DEAD: abandoned.
//
// Archiving is NOT a status — it is the `archived_at` column, which is where it
// already lived: the ARCHIVED status carried 0 rows while 9 rows were archived.
export const MC_STATUSES = [
  "DRAFT",
  "PREVIEW",
  "APPROVED",
  "ACTIVE",
  "INACTIVE",
  "DEAD",
] as const;

export type McStatus = (typeof MC_STATUSES)[number];

// What a card in the matrix can be. DRAFT is deliberately absent: a draft has
// no audience (schema check `messages_draft_has_no_audience`), so offering it
// in the matrix filter or the editor dropdown would only ever produce a
// constraint error.
export const MATRIX_STATUSES: readonly McStatus[] = MC_STATUSES.filter(
  (s) => s !== "DRAFT",
);

// The status a matrix card is born in — see PREVIEW above.
export const BIRTH_STATUS: McStatus = "PREVIEW";

// Placement- and delete-locked: the PMMID is a live or historical measurement
// key, so moving the row would make that key describe a cell it never ran in.
// Archived rows keep whichever status they had, so an archived ACTIVE card stays
// locked by this list; a discarded draft does not, and is still purgeable.
export const MEASUREMENT_LOCKED_STATUSES: readonly McStatus[] = [
  "ACTIVE",
  "INACTIVE",
];

export function isMeasurementLocked(status: string | null | undefined): boolean {
  return MEASUREMENT_LOCKED_STATUSES.includes(status as McStatus);
}

/** `DRAFT` → `--status-draft` / `status-dot--draft`. */
export function statusSlug(status: McStatus): string {
  return status.toLowerCase();
}

export const DEFAULT_STATUS_COLORS: Record<McStatus, string> = {
  DRAFT: "#8b5cf6",
  PREVIEW: "#a855f7",
  APPROVED: "#10b981",
  ACTIVE: "#22c55e",
  INACTIVE: "#6b7280",
  DEAD: "#000000",
};
