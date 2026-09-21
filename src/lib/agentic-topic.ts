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

// Which channel a delivered size belongs to. The Agentic axis is channels, and
// an MC's files scatter across them BY SIZE — a 1080x1080 is Social, a 300x250
// is Display — which is why the promote dialog never asks for a DCO audience
// there: the placement is a fact about the files, not a choice.
const SOC_SIZES = new Set(["1080x1080", "1200x628"]);

export function channelCodeForSize(dimensions: string | null): "SOC" | "DISP" {
  return dimensions && SOC_SIZES.has(dimensions.toLowerCase()) ? "SOC" : "DISP";
}
