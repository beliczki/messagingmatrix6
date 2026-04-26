import { evaluatePattern } from "@/lib/patterns";

// Generate UTM fields for a message. v5 uses per-field patterns under
// config.patterns.trafficking.<field>; the v6 default in defaults.ts mirrors
// that shape. No v5 fixture is available, so this targets the behavior the
// default patterns clearly imply (audience-derived product/strategy + year).

export type TraffickingFields = {
  utm_campaign: string;
  utm_source: string;
  utm_medium: string;
  utm_content: string;
  utm_term: string;
  utm_cd26: string;
};

export type TraffickingPatterns = Partial<TraffickingFields>;

export type TraffickingContext = {
  number: number | null;
  variant: string | null;
  audienceKey: string | null;
  topicKey: string | null;
  audience?: {
    product?: string | null;
    strategy?: string | null;
    device?: string | null;
    targetingType?: string | null;
  } | null;
  topic?: {
    product?: string | null;
  } | null;
};

export function generateTrafficking(
  ctx: TraffickingContext,
  patterns: TraffickingPatterns | null | undefined,
): TraffickingFields {
  const now = new Date();
  // Audience is the v5-canonical source of product/strategy/device for UTMs.
  // Topic.product fills in only if the audience has none.
  const product =
    ctx.audience?.product ?? ctx.topic?.product ?? "";

  const evalCtx: Record<string, unknown> = {
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
  };

  const evalField = (p: string | undefined): string =>
    p ? evaluatePattern(p, evalCtx) : "";

  return {
    utm_campaign: evalField(patterns?.utm_campaign),
    utm_source: evalField(patterns?.utm_source),
    utm_medium: evalField(patterns?.utm_medium),
    utm_content: evalField(patterns?.utm_content),
    utm_term: evalField(patterns?.utm_term),
    utm_cd26: evalField(patterns?.utm_cd26),
  };
}
