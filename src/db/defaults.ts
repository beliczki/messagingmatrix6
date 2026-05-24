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
  statusColors: {
    INCOMING: "#9ca3af",
    NAMING: "#f59e0b",
    CONTENT: "#3b82f6",
    PREVIEW: "#a855f7",
    APPROVED: "#10b981",
    ACTIVE: "#22c55e",
    INACTIVE: "#6b7280",
    ARCHIVED: "#4b5563",
    ERROR: "#ef4444",
    DEAD: "#000000",
    MEMORY: "#ec4899",
  },
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
};

export const DEFAULT_CREATIVE_PARSING_RULES = {
  brand: { type: "segment", index: 0, separator: "_" },
  product: { type: "segment", index: 1, separator: "_" },
  type: { type: "extension_type" },
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
      key: "creativeParsingRules",
      category: "structure",
      value: DEFAULT_CREATIVE_PARSING_RULES,
    },
    { key: "visibleTemplates", category: "templates", value: {} },
  ];
}
