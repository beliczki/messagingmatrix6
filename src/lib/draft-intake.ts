// The intake of a draft MC: what the Brief tab asks once for the whole number.
//
// A draft's variants are alternative creatives for ONE brief, so these travel
// together — a fan-out in updateMessage writes them to every live draft row on
// the number. The list lives here rather than in entities/messages so the
// client can name the same fields without importing the server module (and its
// db handle) to do it.
export const MC_LEVEL_DRAFT_FIELDS = [
  "brief",
  "briefSlidesFileId",
  "briefSlideId",
  "topic",
  "draftProduct",
  "draftTarget",
] as const;

export type McLevelDraftField = (typeof MC_LEVEL_DRAFT_FIELDS)[number];

/** True when a payload would fan out — i.e. writes rows it does not return. */
export function touchesDraftIntake(payload: object): boolean {
  return MC_LEVEL_DRAFT_FIELDS.some((f) => f in payload);
}
