import { describe, it, expect } from "vitest";
import { STATUS_OPTIONS, STATUS_COLOR } from "@/app/(app)/matrix/types";
import { lookAndFeelToCssVars } from "@/lib/branding";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";

// Guards the single-source-of-truth wiring for status colours (W0.1):
// matrix status dots + filter swatches must read the `lookAndFeel` CSS-var
// tokens, not hardcoded Tailwind `bg-*` classes.
describe("status colour single source of truth", () => {
  it("maps every status to its CSS-var-backed dot class (no bg-* left)", () => {
    for (const status of STATUS_OPTIONS) {
      expect(STATUS_COLOR[status]).toBe(`status-dot--${status.toLowerCase()}`);
    }
  });

  it("emits a --status-<x> CSS var for every status, incl. archived", () => {
    const vars = lookAndFeelToCssVars(DEFAULT_LOOK_AND_FEEL);
    for (const status of STATUS_OPTIONS) {
      expect(vars).toHaveProperty(`--status-${status.toLowerCase()}`);
    }
    // Regression: the SSR emitter used to skip ARCHIVED, leaving the dot
    // unstyled on first paint.
    expect(vars["--status-archived"]).toBe(
      DEFAULT_LOOK_AND_FEEL.statusColors.ARCHIVED,
    );
  });
});
