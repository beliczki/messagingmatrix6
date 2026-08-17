// MC numbering. v5-locked behavior for single-number cells. Spec §14.
// Cases are golden in tests/fixtures/v5/mc-numbering/cases.json.
// Source-of-truth: v5 src/hooks/useMatrix.js:377-409.
// v6 extension: a cell may hold multiple MC numbers (creative generations).
// The variant sequence is scoped per number, not per cell — nextMcSlot's
// occupied branch bumps the variant among occupants sharing the chosen
// number only.

export type ExistingMessage = {
  number?: number | null;
  variant?: string | null;
  topic?: string | null;
  audience?: string | null;
  status?: string | null;
  archivedAt?: string | null;
};

export type McSlot = {
  number: number;
  variant: string;
  version: number; // legacy v5 field name; equivalent to v6's version_no
};

export function isLive(m: ExistingMessage): boolean {
  return m.status !== "deleted" && (m.archivedAt ?? null) === null;
}

function maxVariantChar(messages: ExistingMessage[]): string {
  // v5 treats a missing/empty variant on an existing message as "a" — see the
  // `variant-missing-defaults-to-a` fixture case.
  let max = "a".charCodeAt(0);
  for (const m of messages) {
    const c =
      typeof m.variant === "string" && m.variant.length > 0
        ? m.variant.charCodeAt(0)
        : "a".charCodeAt(0);
    if (c > max) max = c;
  }
  return String.fromCharCode(max + 1);
}

// Determine the (number, variant, version) for a NEW message inserted at the
// (topic, audience) cell. Matches v5 useMatrix.js:377-409 behavior:
//   - Cell empty (or only deleted) → number = MAX(non-deleted in `messages`) + 1,
//     variant = 'a', version = 1
//   - Cell occupied → number = existing cell number,
//     variant = next char after MAX(variant char code)
export function nextMcSlot(
  messages: ExistingMessage[],
  targetTopic: string,
  targetAudience: string,
): McSlot {
  const live = messages.filter(isLive);
  const inCell = live.filter(
    (m) => m.topic === targetTopic && m.audience === targetAudience,
  );

  if (inCell.length === 0) {
    // Empty cell — max over the passed set (createMessage passes one axis).
    return { number: nextNewNumber(messages), variant: "a", version: 1 };
  }

  // Occupied — first occupant's number, next variant among that number's
  // occupants (a mixed cell's other numbers don't advance this sequence).
  const number = inCell.find((m) => typeof m.number === "number")?.number ?? 1;
  return {
    number,
    variant: maxVariantChar(inCell.filter((m) => (m.number ?? 1) === number)),
    version: 1,
  };
}

// Next free MC number: MAX(live numbers in the passed set) + 1. Numbers identify
// a card across audience copies, so allocation is never per cell. The caller
// decides the scope of `messages`: createMessage passes ONE axis (DCO or
// nonDCO), because the two are independent number spaces — a new DCO MC must
// not jump to 400+ just because the static nonDCO library climbed that high.
export function nextNewNumber(messages: ExistingMessage[]): number {
  let max = 0;
  for (const m of messages.filter(isLive)) {
    if (typeof m.number === "number" && m.number > max) max = m.number;
  }
  return max + 1;
}

// Next variant for a specific number among a cell's occupants: "a" when no
// live occupant carries the number, else one past the max variant char of
// those that do. Copy/move collision handling and explicit-number creates
// use this so a mixed cell never renumbers or cross-pollutes variants.
export function nextVariantForNumber(
  occupants: ExistingMessage[],
  number: number,
): string {
  const matching = occupants.filter((m) => isLive(m) && m.number === number);
  if (matching.length === 0) return "a";
  return maxVariantChar(matching);
}
