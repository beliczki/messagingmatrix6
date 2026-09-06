import { MC_STATUSES, statusSlug } from "@/lib/mc-status";
export type Audience = {
  id: number;
  key: string;
  name: string;
  product: string | null;
  orderIndex: number;
  status: string | null;
  strategy: string | null;
  buyingPlatform: string | null;
  dataSource: string | null;
  targetingType: string | null;
  device: string | null;
  tag: string | null;
  comment: string | null;
  campaignName: string | null;
  campaignId: string | null;
  lineitemName: string | null;
  lineitemId: string | null;
  /** Agentic scoping: NULL = DCO audience; a prodlist channel
   *  (DISP|SOC|PRG|GSN|GNW|YT) = an Agentic channel-audience. */
  channel: string | null;
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  /** Count of messages (archived OR live) referencing this audience.key.
   *  Computed at list-time, not stored. > 0 means the auto-key is frozen. */
  mcCount?: number;
  /** The key this row's pattern WOULD produce now (list-time, not stored). */
  generatedKey?: string;
  /** generatedKey !== key — a field edit moved on without the key, because the
   *  MC-guard froze it. Surfaced in the header dialog with a rekey action. */
  keyStale?: boolean;
};

// Agentic channel (own table). Presented to the grid as an Audience with
// channel = code (non-null ⇒ Agentic axis) so the existing DCO/Agentic column
// logic treats channels exactly as the old channel-audience rows did.
export type Channel = {
  id: number;
  key: string;
  code: string;
  label: string;
  orderIndex: number;
  archivedAt: string | null;
};

export function channelToAudience(c: Channel): Audience {
  return {
    id: c.id,
    key: c.key,
    name: c.label,
    product: null,
    orderIndex: c.orderIndex,
    status: null,
    strategy: null,
    buyingPlatform: null,
    dataSource: null,
    targetingType: null,
    device: null,
    tag: null,
    comment: null,
    campaignName: null,
    campaignId: null,
    lineitemName: null,
    lineitemId: null,
    channel: c.code,
    version: 1,
    updatedAt: "",
    archivedAt: c.archivedAt,
  };
}

export type TextFormattingRule = {
  id: number;
  textOriginal: string;
  textFormatted: string;
  formattingScope: string | null;
  formattingMcScope: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Topic = {
  id: number;
  key: string;
  name: string;
  product: string | null;
  orderIndex: number;
  status: string | null;
  tag: string | null;
  tag1: string | null;
  tag2: string | null;
  tag3: string | null;
  tag4: string | null;
  comment: string | null;
  created: string | null;
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  /** Count of messages (archived OR live) referencing this topic.key.
   *  Computed at list-time, not stored. > 0 means the auto-key is frozen. */
  mcCount?: number;
  /** The key this row's pattern WOULD produce now (list-time, not stored). */
  generatedKey?: string;
  /** generatedKey !== key — a tag edit moved on without the key, because the
   *  MC-guard froze it. Surfaced in the header dialog with a rekey action. */
  keyStale?: boolean;
};

export type Message = {
  id: number;
  number: number;
  variant: string;
  audience: string;
  topic: string;
  status: string | null;
  name: string | null;
  headline: string | null;
  copy1: string | null;
  copy2: string | null;
  disclaimer: string | null;
  headlineStyle: string | null;
  copy1Style: string | null;
  copy2Style: string | null;
  disclaimerStyle: string | null;
  ctaStyle: string | null;
  customCss: string | null;
  template: string | null;
  templateVariantClasses: string | null;
  versionNo: number;
  version: number; // optimistic-lock version
  pmmid: string | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string;
  flash: string | null;
  flashStyle: string | null;
  cta: string | null;
  landingUrl: string | null;
  image1: string | null;
  image2: string | null;
  image3: string | null;
  image4: string | null;
  image5: string | null;
  image6: string | null;
  video1: string | null;
  utmCampaign: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  utmCd26: string | null;
  finalTraffickedUrl: string | null;
  archivedAt: string | null;
  // Brief tab: the free-text note, the Slides deck the work came in on, and
  // the slide within that deck (a Google page object id — see slides-link.ts).
  brief: string | null;
  briefId: number | null;
  briefSlideId: string | null;
};

// The same row before it has a cell. The schema made `audience`/`topic`
// nullable for exactly this state (a DRAFT is a messages row whose ABSENCE of
// an audience is what keeps it out of the matrix), and the editor is shared
// between the two — so the difference is a type, not a second component.
// `topic` survives as a nullable WORKING TITLE; promotion is what resolves it
// to a real key.
export type DraftMessage = Omit<Message, "audience" | "topic"> & {
  audience: null;
  topic: string | null;
};

/** What the shared editor accepts: a placed card, or a draft. */
export type EditableMessage = Message | DraftMessage;

// A brief as /api/briefs returns it: the deck's identity is the Drive FILE ID,
// not the URL someone pasted (three spellings of one deck would otherwise read
// as three briefs). `openDrafts`/`promoted` are counted from the work itself,
// which is why they need no state column to keep in sync.
export type Brief = {
  id: number;
  slidesFileId: string;
  label: string | null;
  openDrafts: number;
  promoted: number;
  archivedAt: string | null;
  createdAt: string;
};

// The matrix filter and the editor dropdown offer the placeable statuses; the
// canonical list lives in @/lib/mc-status so this file cannot drift from the
// Design tab, the DB defaults and the branding vars the way it used to.
export { MATRIX_STATUSES as STATUS_OPTIONS } from "@/lib/mc-status";

// Values are CSS-var-backed dot-modifier classes (globals.css `.status-dot--*`),
// so every consumer inherits the `lookAndFeel` status colours the Design tab
// writes — single source of truth, not hardcoded Tailwind `bg-*` classes.
export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  MC_STATUSES.map((s) => [s, `status-dot--${statusSlug(s)}`]),
);

// Buying-platform colours. The colour VALUES live once in globals.css as
// --plat-* custom properties; this list is the single source for which platform
// values have one. Two consumers: the matrix audience-header edge strip
// (GridView) and the tree-view node stripe. buyingPlatform is a free-text
// field, so an unrecognised value gets no platform colour and the consumer
// keeps its default — giving a new platform (youtube, meta, …) a colour is one
// entry here plus one --plat-* var and its two class rules.
export const PLATFORM_TOKENS = ["dv360", "adform"] as const;

export function platformToken(p: string | null | undefined): string | null {
  if (!p) return null;
  const v = p.trim().toLowerCase();
  return (PLATFORM_TOKENS as readonly string[]).includes(v) ? v : null;
}

export type View = "grid" | "sankey" | "tree";
export type Density = "detailed" | "compact" | "dense";

// Which matrix world the grid shows. "dco" = template-driven messages
// (audiences with channel = null). "nondco" = static image creatives promoted
// onto the 6 prodlist channel-audiences (channel != null).
export type MatrixAxis = "dco" | "nondco";

export type Filters = {
  axis: MatrixAxis;
  products: Set<string>;
  statuses: Set<string>;
  search: string;
};

export const EMPTY_FILTERS: Filters = {
  axis: "dco",
  products: new Set(),
  statuses: new Set(),
  search: "",
};
