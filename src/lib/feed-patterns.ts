// Feed-view column → pattern resolution.
// v5 parity: each feedStructure column ("Type:field_name" or just "field_name")
// maps to a pattern in config.patterns.feed[column]. If the user has not
// defined a pattern, fall back to a built-in mapping based on the cleaned
// (prefix-stripped) column name. Anything still unmapped renders the cleaned
// name as a {{placeholder}}.

const DEFAULT_FEED_PATTERN_MAP: Record<string, string> = {
  // Text fields
  headline_text_1: "{{headline}}",
  headline_text: "{{headline}}",
  headline: "{{headline}}",
  copy_text_1: "{{copy1}}",
  copy1: "{{copy1}}",
  copy_text_2: "{{copy2}}",
  copy2: "{{copy2}}",
  click_text: "{{cta}}",
  cta_text_1: "{{cta}}",
  cta: "{{cta}}",
  flash_text: "{{flash}}",
  sticker_text_1: "{{flash}}",
  flash: "{{flash}}",
  disclaimer_text: "{{disclaimer}}",
  disclaimer: "{{disclaimer}}",
  // Style fields
  headline_style_1: "{{headlineStyle}}",
  headline_style: "{{headlineStyle}}",
  copy_style_1: "{{copy1Style}}",
  copy1_style: "{{copy1Style}}",
  copy_style_2: "{{copy2Style}}",
  copy2_style: "{{copy2Style}}",
  flash_style: "{{flashStyle}}",
  sticker_style_1: "{{flashStyle}}",
  cta_style: "{{ctaStyle}}",
  cta_style_1: "{{ctaStyle}}",
  disclaimer_style: "{{disclaimerStyle}}",
  css_styles: "{{customCss}}",
  css: "{{customCss}}",
  // Identity / naming
  template_variant_class: "{{templateVariantClasses}}",
  template_variant_classes: "{{templateVariantClasses}}",
  messaging_card_id: "{{number}}",
  messaging_card_variant: "{{variant}}",
  advert_name: "{{name}}",
  name: "{{name}}",
  number: "{{number}}",
  variant: "{{variant}}",
  pmmid: "{{pmmid}}",
  advert_id: "{{pmmid}}",
  landingurl: "{{landingUrl}}",
  clicktag: "{{landingUrl}}",
  // Image fields
  background_image_1: "{{image1}}",
  image1: "{{image1}}",
  background_image_2: "{{image2}}",
  image2: "{{image2}}",
  background_image_3: "{{image3}}",
  image3: "{{image3}}",
  background_image_4: "{{image4}}",
  image4: "{{image4}}",
  sticker_image_1: "{{image6}}",
  image6: "{{image6}}",
  background_image_logo: "{{image5}}",
  image5: "{{image5}}",
};

export function parseFeedColumns(feedStructure: string): string[] {
  if (!feedStructure) return [];
  return feedStructure
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

export function cleanColumnName(column: string): string {
  // Strip "Type:" prefix (e.g. "Text:advert_id" → "advert_id").
  return column.replace(/^[^:]+:/, "");
}

export function defaultFeedPattern(column: string): string {
  const clean = cleanColumnName(column).toLowerCase();
  return DEFAULT_FEED_PATTERN_MAP[clean] ?? `{{${clean}}}`;
}

export function resolveFeedPattern(
  column: string,
  feedPatterns: Record<string, string> | null | undefined,
): string {
  const explicit = feedPatterns?.[column];
  if (explicit && explicit.trim()) return explicit;
  return defaultFeedPattern(column);
}
