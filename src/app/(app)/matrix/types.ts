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
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  /** Count of messages (archived OR live) referencing this audience.key.
   *  Computed at list-time, not stored. > 0 means the auto-key is frozen. */
  mcCount?: number;
};

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

export const STATUS_COLOR: Record<string, string> = {
  INCOMING: "bg-slate-300",
  NAMING: "bg-amber-400",
  CONTENT: "bg-blue-500",
  PREVIEW: "bg-purple-500",
  APPROVED: "bg-emerald-500",
  ACTIVE: "bg-green-500",
  INACTIVE: "bg-slate-400",
  ARCHIVED: "bg-slate-500",
  ERROR: "bg-rose-500",
  DEAD: "bg-slate-900",
  MEMORY: "bg-pink-500",
};

export type View = "grid" | "feed" | "tree";
export type Density = "detailed" | "compact" | "dense";

export type Filters = {
  products: Set<string>;
  statuses: Set<string>;
  search: string;
};

export const EMPTY_FILTERS: Filters = {
  products: new Set(),
  statuses: new Set(),
  search: "",
};
