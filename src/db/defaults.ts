import { DEFAULT_STATUS_COLORS } from "@/lib/mc-status";
// Default config values written for a freshly-created client (Spec §17.6).
// A new Telekom or Proficio deploy boots with these so Settings has something
// to render and login branding works on first paint.

export const DEFAULT_LOOK_AND_FEEL = {
  logo: "",
  pageTitle: "MessagingMatrix",
  fontFamily: "Inter",
  capsuleDesign: false,
  colorMode: "system" as "light" | "dark" | "system",
  headerColor: "#1f2937",
  buttonColor: "#2563eb",
  secondaryColor1: "#f3f4f6",
  secondaryColor2: "#e5e7eb",
  secondaryColor3: "#d1d5db",
  secondaryColor4: "#9ca3af",
  cobranding: { enabled: false, logoUrl: "" },
  // From @/lib/mc-status so the Design tab, the branding CSS vars and this
  // default cannot disagree about which statuses exist.
  statusColors: { ...DEFAULT_STATUS_COLORS },
};

export const DEFAULT_PATTERNS = {
  pmmid:
    "a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version_no}}",
  audienceKey:
    "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})",
  topicKey:
    "join({{product|lower}}, {{tag1|lower}}, {{tag2|lower}}, {{tag3|lower}}, {{tag4|lower}})",
  trafficking: {
    utm_campaign: "{{product|lower}}",
    utm_source: "{{strategy|lower}}",
    utm_medium: "display",
    utm_content: "MC{{number}}{{variant}}",
    utm_term: "",
    utm_cd26: "{{product}}_{{audience}}",
  },
  feed: {},
};

export const DEFAULT_STRUCTURES = {
  audienceStructure:
    "key,name,product,strategy,buying_platform,data_source,targeting_type,device,status,comment",
  topicStructure:
    "key,name,product,tag1,tag2,tag3,tag4,strategy,status,comment",
  messagesStructure:
    "number,variant,audience,topic,status,template,headline,copy1,copy2,cta,landing_url,start_date,end_date,comment",
  creativeStructure:
    "brand,product,type,template,banner_version,mc_number,mc_variant,visual_keyword,copy_keyword,file_name,comment",
  feedStructure: "Text:pmmid",
  treeStructure: "Product → Strategy → Audience → Topic → Messages",
};

export const DEFAULT_CREATIVE_PARSING_RULES = {
  brand: { type: "segment", index: 0, separator: "_" },
  product: { type: "segment", index: 1, separator: "_" },
  type: { type: "extension_type" },
  // BRAND_PRODUCT_MC<number>_<variant>_… — the MC token is the naming
  // convention across every surface, so the upload queue can fill both in.
  // The variant rule takes a SINGLE lowercase letter only: a handful of legacy
  // files carry a different token there (va / px / bg / c1), and those are not
  // variants — leaving the field blank for a human beats guessing wrong.
  mcNumber: { type: "pattern", pattern: "MC(\\d+)", group: 1 },
  mcVariant: { type: "pattern", pattern: "MC\\d+_([a-z])_", group: 1 },
};

export type ConfigSeed = Array<{
  key: string;
  category: string;
  value: unknown;
}>;

export function defaultConfigSeed(): ConfigSeed {
  return [
    { key: "lookAndFeel", category: "lookAndFeel", value: DEFAULT_LOOK_AND_FEEL },
    { key: "patterns", category: "patterns", value: DEFAULT_PATTERNS },
    {
      key: "audienceStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.audienceStructure,
    },
    {
      key: "topicStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.topicStructure,
    },
    {
      key: "messagesStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.messagesStructure,
    },
    {
      key: "creativeStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.creativeStructure,
    },
    {
      key: "feedStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.feedStructure,
    },
    {
      key: "treeStructure",
      category: "structure",
      value: DEFAULT_STRUCTURES.treeStructure,
    },
    {
      key: "creativeParsingRules",
      category: "structure",
      value: DEFAULT_CREATIVE_PARSING_RULES,
    },
    { key: "visibleTemplates", category: "templates", value: {} },
  ];
}
