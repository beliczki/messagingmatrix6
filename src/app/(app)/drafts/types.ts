// Client-side shapes for the drafts surface. A draft is a `messages` row and
// `/api/drafts` returns those rows whole, so these are ALIASES of the matrix
// types rather than a second, narrower description of the same data — the
// drafts page and the matrix editor are now the same editor, and two shapes for
// one row would only differ by whatever the next field addition forgot.
import type { Brief, DraftMessage } from "../matrix/types";

export type Draft = DraftMessage;
export type BriefRow = Brief;

export type DraftPreview = {
  id: number;
  messageId: number;
  size: string;
  /** Snapshot of messages.version at capture time → staleness. */
  messageVersion: number;
  updatedAt: string;
};
