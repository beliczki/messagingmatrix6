// Client-side shapes for the drafts surface. A draft is a `messages` row, so
// these mirror the message columns the page actually reads — `audience` is
// absent on purpose: having none is what makes the row a draft.

export type Draft = {
  id: number;
  number: number;
  variant: string;
  status: string;
  /** Suggested working title. Not a topics key until promotion resolves it. */
  topic: string | null;
  briefId: number | null;
  name: string | null;
  headline: string | null;
  copy1: string | null;
  copy2: string | null;
  disclaimer: string | null;
  cta: string | null;
  template: string | null;
  brief: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftPreview = {
  id: number;
  messageId: number;
  size: string;
  /** Snapshot of messages.version at capture time → staleness. */
  messageVersion: number;
  updatedAt: string;
};

export type BriefRow = {
  id: number;
  slidesFileId: string;
  label: string | null;
  openDrafts: number;
  promoted: number;
  archivedAt: string | null;
  createdAt: string;
};
