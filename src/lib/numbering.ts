// MC numbering. v5-locked behavior. Spec §14.
// Cases are golden in tests/fixtures/v5/mc-numbering/cases.json.
// Source-of-truth: v5 src/hooks/useMatrix.js:377-409.

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

function isLive(m: ExistingMessage): boolean {
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
//   - Cell empty (or only deleted) → number = MAX(non-deleted globally) + 1,
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
    // Empty cell — global max.
    let max = 0;
    for (const m of live) {
      if (typeof m.number === "number" && m.number > max) max = m.number;
    }
    return { number: max + 1, variant: "a", version: 1 };
  }

  // Occupied — same number, next variant.
  const number = inCell.find((m) => typeof m.number === "number")?.number ?? 1;
  return { number, variant: maxVariantChar(inCell), version: 1 };
}
