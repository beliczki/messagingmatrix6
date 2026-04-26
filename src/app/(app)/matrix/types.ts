export type Audience = {
  id: number;
  key: string;
  name: string;
  product: string | null;
  orderIndex: number;
  status: string | null;
  strategy: string | null;
  device: string | null;
};

export type Topic = {
  id: number;
  key: string;
  name: string;
  product: string | null;
  orderIndex: number;
  status: string | null;
  tag1: string | null;
  tag2: string | null;
  tag3: string | null;
  tag4: string | null;
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
  utmCampaign: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  utmCd26: string | null;
  finalTraffickedUrl: string | null;
};

export const STATUS_COLOR: Record<string, string> = {
  INCOMING: "bg-slate-300",
  NAMING: "bg-amber-400",
  CONTENT: "bg-blue-500",
  PREVIEW: "bg-purple-500",
  APPROVED: "bg-emerald-500",
  ACTIVE: "bg-green-500",
  INACTIVE: "bg-slate-400",
  ERROR: "bg-rose-500",
  DEAD: "bg-slate-900",
  MEMORY: "bg-pink-500",
};

export type View = "grid" | "feed";
export type Density = "informative" | "minimal";

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
