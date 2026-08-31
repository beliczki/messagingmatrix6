// The one feed column whose header depends on who serves the line item.
//
// AdForm expects its own placement-id signal, DV360 an external one. ONLY the
// header differs: the value is the audience's lineitem_id either way, and an
// audience already carries the id belonging to its own buying platform. That is
// why this is a rename at write time and not a second column, a second pattern,
// or a second feed structure.
//
// Deliberately dependency-free so the export panel (client) and the routes
// (server) share one list instead of two that drift.
export const SIGNAL_COLUMN_OPTIONS = [
  { value: "AdformSignal:ADFPLAID", label: "AdForm — AdformSignal:ADFPLAID" },
  {
    value: "ExternalSignal:ExternalSignal",
    label: "DV360 — ExternalSignal:ExternalSignal",
  },
] as const;

export type SignalColumn = (typeof SIGNAL_COLUMN_OPTIONS)[number]["value"];

// What Settings → Structure → Feed structure carries today, so an export that
// says nothing about the signal keeps producing exactly what it produced before.
export const DEFAULT_SIGNAL_COLUMN: SignalColumn = "AdformSignal:ADFPLAID";

// A feed's platform and its signal header are the same statement said twice:
// one header per platform, one platform per file. Deriving one from the other
// keeps a stored row from ever claiming a platform its header contradicts.
export const PLATFORM_BY_SIGNAL_COLUMN: Record<string, string> = {
  "AdformSignal:ADFPLAID": "adform",
  "ExternalSignal:ExternalSignal": "dv360",
};

export function platformForSignalColumn(signalColumn: string): string {
  return PLATFORM_BY_SIGNAL_COLUMN[signalColumn] ?? "adform";
}

export function signalColumnForPlatform(platform: string): SignalColumn {
  const hit = SIGNAL_COLUMN_OPTIONS.find(
    (o) => PLATFORM_BY_SIGNAL_COLUMN[o.value] === platform,
  );
  return hit ? hit.value : DEFAULT_SIGNAL_COLUMN;
}

export function isSignalColumn(name: string): boolean {
  return SIGNAL_COLUMN_OPTIONS.some((o) => o.value === name);
}

export function isValidSignalColumn(v: unknown): v is SignalColumn {
  return typeof v === "string" && isSignalColumn(v);
}
