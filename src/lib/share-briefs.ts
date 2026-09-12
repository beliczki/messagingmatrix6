import { slidesUrl } from "./slides-link";

// The brief deck behind a shared card. A share is a frozen snapshot, but the
// brief is not part of it: snapshots store the message row as it was captured,
// and older ones predate the brief columns entirely. So the share page resolves
// the deck live, by card, and a brief added after the share was sent shows up
// the next time someone opens the link — which is the behaviour a reviewer
// wants from a link to "the brief", as opposed to from the creatives.

/** How a card is named on the share page, and the key both sides agree on. */
export function briefKey(
  number: number | null | undefined,
  variant: string | null | undefined,
): string | null {
  if (number === null || number === undefined) return null;
  return `MC${number}${variant ?? ""}`;
}

export type ShareBrief = {
  /** Drive file id of the deck — several cards share one deck. */
  fileId: string;
  /** Deep link: the deck, opened at the card's own slide when it names one. */
  url: string;
};

/** briefKey -> the deck that card was briefed on. */
export type ShareBriefs = Record<string, ShareBrief>;

export function briefUrl(fileId: string, slideId: string | null): string {
  const base = slidesUrl(fileId)!;
  return slideId ? `${base}#slide=id.${slideId}` : base;
}
