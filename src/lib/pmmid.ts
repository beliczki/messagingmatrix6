// PMMID generator. v5-locked behavior. Spec §14.
// Cases are golden in tests/fixtures/v5/pmmid/cases.json.
//
// PMMID is a measurement key: it encodes audience/topic/number/variant/versionNo
// and flows into UTM content + reporting labels. It is regenerated whenever any
// of those inputs change — including on audience move (see `moveMessages` in
// `src/lib/entities/messages.ts`). Movement is blocked once the row enters a
// measurement-locked status (ACTIVE / INACTIVE / ARCHIVED), at which point the
// pmmid is effectively frozen because the row itself can no longer move.

import { evaluatePattern } from "@/lib/patterns";

// Source of truth: v5 src/hooks/useMatrix.js:412 — used on addMessage.
// Hardcoded format used when no pattern is configured.
const HARDCODED_FORMAT =
  "a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version}}";

export type PmmidMessage = {
  audience: string | null;
  topic: string | null;
  number: number | null;
  variant: string | null;
  // The MC's version (`messages.version_no`, the -n_ token; REBUILD_SPEC §21).
  // v5 called it `version`, but in v6 that name is the optimistic-lock save
  // counter, so only `versionNo` is read: a row object carries both, and a
  // fallback to `version` put the save counter into the measurement key
  // whenever a caller left versionNo out.
  versionNo: number;
};

export function generatePmmid(
  message: PmmidMessage,
  audiences: ReadonlyArray<Record<string, unknown>> = [],
  topics: ReadonlyArray<Record<string, unknown>> = [],
  pattern?: string | null,
): string {
  const versionNumber = message.versionNo;
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new Error(
      `generatePmmid: versionNo must be a whole number ≥ 1, got ${String(versionNumber)}`,
    );
  }
  const ctx: Record<string, unknown> = {
    audience: message.audience ?? "",
    topic: message.topic ?? "",
    number: message.number ?? "",
    variant: message.variant ?? "",
    // Both names point at the same value, for v5+v6 pattern compatibility.
    version: versionNumber,
    version_no: versionNumber,
    // v5-style aliases used in array-by-var-key lookups, e.g.
    //   {{audiences[Audience_Key].Product|lower}}
    Audience_Key: message.audience ?? "",
    Topic_Key: message.topic ?? "",
    audiences,
    topics,
  };
  return evaluatePattern(pattern ?? HARDCODED_FORMAT, ctx);
}
