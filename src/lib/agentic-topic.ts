// The topic string an Agentic MC lands on when the matrix has never seen its
// number: "<PRODUCT>_<keywords>", read out of the delivered filename.
//
// The Agentic axis has no topics dimension — `ensureAgenticMc` writes the
// string straight onto the message and the grid synthesizes its rows from
// those strings. So this is not a suggestion that a curated row later replaces;
// it IS the topic, which is why the promote dialog offers exactly the same
// string the upload path would have written. Two derivations of "the topic
// this file implies" would drift, and the drift would show up as an MC sitting
// in a near-duplicate row beside its own siblings.
import { parseCreativeFilename } from "./parse-creative-filename";

export function agenticTopicFromFilename(
  fileName: string | null | undefined,
  product: string | null | undefined,
): string {
  const parsed = parseCreativeFilename(fileName ?? "");
  const keywords = parsed.keywords.trim().split(/\s+/).filter(Boolean).join("_");
  const p = product ?? parsed.product ?? "";
  return [p, keywords].filter(Boolean).join("_").slice(0, 200) || "creative";
}

/**
 * An Agentic topic key split into what a reader sees and what filters on it.
 *
 * The key CARRIES the product (`SZA_diakszamla_2026Q1_colorAndImage`) and that
 * is load-bearing rather than noise. It is what splits two products that
 * briefed the same topic into two rows — `SZA_BeErste3Q2_personas` and
 * `VAL_BeErste3Q2_personas` are two campaigns, not one — and it is the only
 * place the product reaches the PMMID at all, whose pattern
 * (`a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version}}`) has
 * no product token of its own.
 *
 * What it must not do is shout at a reader. The grid has always dropped the
 * prefix from the row label and shown the product as its own tag; this is that
 * rule lifted into one place, so the promote dialog stops being the single
 * surface that spells the raw key out (user, 2026-09-23).
 */
export function splitAgenticTopic(key: string): {
  product: string | null;
  name: string;
} {
  const i = key.indexOf("_");
  return i > 0
    ? { product: key.slice(0, i), name: key.slice(i + 1) }
    : { product: null, name: key };
}

// Which channel a delivered size belongs to. The Agentic axis is channels, and
// an MC's files scatter across them BY SIZE — a 1080x1080 is Social, a 300x250
// is Display — which is why the promote dialog never asks for a DCO audience
// there: the placement is a fact about the files, not a choice.
const SOC_SIZES = new Set(["1080x1080", "1200x628"]);

export function channelCodeForSize(dimensions: string | null): "SOC" | "DISP" {
  return dimensions && SOC_SIZES.has(dimensions.toLowerCase()) ? "SOC" : "DISP";
}
