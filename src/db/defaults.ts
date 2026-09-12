import { DEFAULT_STATUS_COLORS } from "@/lib/mc-status";
import type { IconSet } from "@/app/_icons/types";
// Default config values written for a freshly-created client (Spec §17.6).
// A new Telekom or Proficio deploy boots with these so Settings has something
// to render and login branding works on first paint.

export const DEFAULT_LOOK_AND_FEEL = {
  logo: "",
  pageTitle: "MessagingMatrix",
  fontFamily: "Inter",
  iconSet: "lucide" as IconSet,
  colorMode: "system" as "light" | "dark" | "system",
  headerColor: "#1f2937",
  buttonColor: "#2563eb",
  secondaryColor1: "#f3f4f6",
  secondaryColor2: "#e5e7eb",
  secondaryColor3: "#d1d5db",
  secondaryColor4: "#9ca3af",
  // No on/off flag: an empty URL is off. A stored `enabled` that disagreed
  // with the URL was a state where a logo was configured and silently not
  // shown, and the checkbox was the only place that difference was visible.
  cobranding: { logoUrl: "" },
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

// The two structures that are actually read: the feed column list (FeedView +
// the reference-feed upload check) and the decision-tree hierarchy (Tree and
// Sankey views).
//
// Four more used to live here — audience/topic/messages/creativeStructure, a
// v5-era CSV column order. Nothing ever read them: the XLSX export names its
// columns in `lib/export-xlsx.ts`, the upload dialog in CreativeLibrary.tsx,
// the grids in their own components. They had also drifted out of the schema
// (topicStructure listed a `strategy` column topics has never had, and
// messagesStructure covered 14 of the row's 46 content columns), so the tab
// looked like a switch that was wired to nothing. Removed in 6.93.0.
export const DEFAULT_STRUCTURES = {
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
