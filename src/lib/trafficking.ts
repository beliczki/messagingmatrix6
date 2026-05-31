import { evaluatePattern } from "@/lib/patterns";

// Generate UTM fields + the final trafficked URL for a message.
//
// v5 stores per-field patterns under config.patterns.trafficking.<field>. The
// real Erste patterns reference the *audience* row by key and the already-
// generated PMMID/landing URL, e.g.
//   utm_source        = {{audiences[Audience_Key].Buying_platform}}
//   utm_campaign      = {{audiences[Audience_Key].Campaign_name}}
//   utm_cd26          = {{PMMID}}
//   final_trafficked_url = {{Landing_URL}}?utm_campaign={{utm_campaign}}&...
//
// so the evaluation context must carry the full audiences array, the generated
// pmmid, the landing URL, and the v5 capitalized token aliases. The six UTM
// fields are computed first, then injected into the context so the
// final_trafficked_url pattern can reference them.
//
// The v6 generic default (defaults.ts) uses only flat tokens ({{product}},
// {{strategy}}, {{number}}…) and no final_trafficked_url — those keep working
// unchanged because the flat tokens are still seeded below.

export type TraffickingFields = {
  utm_campaign: string;
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  utm_term: string;
  utm_cd26: string;
  final_trafficked_url: string;
};

export type TraffickingPatterns = Partial<TraffickingFields>;

// A v6 ClientPatterns slice — only the trafficking patterns are read here.
export type TraffickingPatternBag = {
  trafficking?: TraffickingPatterns;
};

type AudienceFlat = {
  product?: string | null;
  strategy?: string | null;
  device?: string | null;
  targetingType?: string | null;
} | null;

type TopicFlat = {
  product?: string | null;
} | null;

export type TraffickingContext = {
  number: number | null;
  variant: string | null;
  audienceKey: string | null;
  topicKey: string | null;
  // Generated PMMID for this message (utm_cd26 = {{PMMID}}).
  pmmid?: string | null;
  // Landing URL (final_trafficked_url = {{Landing_URL}}?...).
  landingUrl?: string | null;
  // Full audiences list for {{audiences[Audience_Key].Field}} lookups. Each
  // item is matched by its `key`; only the fields the pattern names are read.
  audiences?: ReadonlyArray<Record<string, unknown>>;
  // Flat audience fields, used by the v6 generic default patterns.
  audience?: AudienceFlat;
  topic?: TopicFlat;
};

export function generateTrafficking(
  ctx: TraffickingContext,
  patterns: TraffickingPatterns | null | undefined,
): TraffickingFields {
  const now = new Date();
  // Audience is the v5-canonical source of product/strategy/device for UTMs.
  // Topic.product fills in only if the audience has none.
  const product = ctx.audience?.product ?? ctx.topic?.product ?? "";

  const evalCtx: Record<string, unknown> = {
    // Flat tokens (v6 generic default patterns).
    audience: ctx.audienceKey ?? "",
    topic: ctx.topicKey ?? "",
    number: ctx.number ?? "",
    variant: ctx.variant ?? "",
    product,
    strategy: ctx.audience?.strategy ?? "",
    device: ctx.audience?.device ?? "",
    targeting_type: ctx.audience?.targetingType ?? "",
    year: now.getFullYear(),
    month: String(now.getMonth() + 1).padStart(2, "0"),
    // v5 token aliases + array lookups (real Erste patterns).
    audiences: ctx.audiences ?? [],
    Audience_Key: ctx.audienceKey ?? "",
    Topic_Key: ctx.topicKey ?? "",
    Number: ctx.number ?? "",
    Variant: ctx.variant ?? "",
    pmmid: ctx.pmmid ?? "",
    landing_url: ctx.landingUrl ?? "",
  };

  const evalField = (p: string | undefined): string =>
    p ? evaluatePattern(p, evalCtx) : "";

  const utm_campaign = evalField(patterns?.utm_campaign);
  const utm_source = evalField(patterns?.utm_source);
  const utm_medium = evalField(patterns?.utm_medium);
  const utm_content = evalField(patterns?.utm_content);
  const utm_term = evalField(patterns?.utm_term);
  const utm_cd26 = evalField(patterns?.utm_cd26);

  // final_trafficked_url references the *computed* UTM values, so inject them
  // before evaluating it.
  evalCtx.utm_campaign = utm_campaign;
  evalCtx.utm_source = utm_source;
  evalCtx.utm_medium = utm_medium;
  evalCtx.utm_content = utm_content;
  evalCtx.utm_term = utm_term;
  evalCtx.utm_cd26 = utm_cd26;
  const final_trafficked_url = evalField(patterns?.final_trafficked_url);

  return {
    utm_campaign,
    utm_source,
    utm_medium,
    utm_content,
    utm_term,
    utm_cd26,
    final_trafficked_url,
  };
}

// DB-row adapter over generateTrafficking. The entity layer holds audience/topic
// as resolved rows plus key strings; this maps them into the flat + by-key
// evaluation context so both the v6 generic defaults and the real Erste
// by-key patterns ({{audiences[Audience_Key].Field}}, {{PMMID}}, {{Landing_URL}})
// resolve. `pmmid` is the already-generated id (utm_cd26 = {{PMMID}}).
export type BuildTraffickingInput = {
  number: number | null;
  variant: string | null;
  audience: string | null; // audience key
  topic: string | null; // topic key
  landingUrl?: string | null;
};

export function buildTrafficking(
  input: BuildTraffickingInput,
  audienceRow: AudienceFlat,
  topicRow: TopicFlat,
  patterns: TraffickingPatternBag | null | undefined,
  audienceList: ReadonlyArray<Record<string, unknown>>,
  pmmid: string | null,
): TraffickingFields {
  return generateTrafficking(
    {
      number: input.number,
      variant: input.variant,
      audienceKey: input.audience,
      topicKey: input.topic,
      pmmid,
      landingUrl: input.landingUrl,
      audiences: audienceList,
      audience: audienceRow
        ? {
            product: audienceRow.product ?? null,
            strategy: audienceRow.strategy ?? null,
            device: audienceRow.device ?? null,
            targetingType: audienceRow.targetingType ?? null,
          }
        : null,
      topic: topicRow ? { product: topicRow.product ?? null } : null,
    },
    patterns?.trafficking,
  );
}
