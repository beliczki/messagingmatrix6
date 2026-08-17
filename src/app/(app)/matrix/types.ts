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
  /** nonDCO scoping: NULL = DCO audience; a prodlist channel
   *  (DISP|SOC|PRG|GSN|GNW|YT) = a nonDCO channel-audience. */
  channel: string | null;
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  /** Count of messages (archived OR live) referencing this audience.key.
   *  Computed at list-time, not stored. > 0 means the auto-key is frozen. */
  mcCount?: number;
};

// nonDCO channel (own table). Presented to the grid as an Audience with
// channel = code (non-null ⇒ nonDCO axis) so the existing DCO/nonDCO column
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
};

export const STATUS_OPTIONS = [
  "INCOMING",
  "NAMING",
  "CONTENT",
  "PREVIEW",
  "APPROVED",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
  "ERROR",
  "DEAD",
  "MEMORY",
] as const;

// Values are CSS-var-backed dot-modifier classes (globals.css `.status-dot--*`),
// so every consumer inherits the `lookAndFeel` status colours the Design tab
// writes — single source of truth, not hardcoded Tailwind `bg-*` classes.
export const STATUS_COLOR: Record<string, string> = {
  INCOMING: "status-dot--incoming",
  NAMING: "status-dot--naming",
  CONTENT: "status-dot--content",
  PREVIEW: "status-dot--preview",
  APPROVED: "status-dot--approved",
  ACTIVE: "status-dot--active",
  INACTIVE: "status-dot--inactive",
  ARCHIVED: "status-dot--archived",
  ERROR: "status-dot--error",
  DEAD: "status-dot--dead",
  MEMORY: "status-dot--memory",
};

export type View = "grid" | "feed" | "tree";
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
