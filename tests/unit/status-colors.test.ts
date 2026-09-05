import { describe, it, expect } from "vitest";
import { STATUS_OPTIONS, STATUS_COLOR } from "@/app/(app)/matrix/types";
import { lookAndFeelToCssVars } from "@/lib/branding";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";
import { MC_STATUSES, MATRIX_STATUSES } from "@/lib/mc-status";

// Guards the single-source-of-truth wiring for status colours (W0.1):
// matrix status dots + filter swatches must read the `lookAndFeel` CSS-var
// tokens, not hardcoded Tailwind `bg-*` classes.
//
// Since 2026-09-05 the list itself is the source of truth (@/lib/mc-status) —
// these assertions now check that every consumer really derives from it, which
// is the property that was missing when PLANNED existed in the matrix filter
// but in no other list and so matched nothing anywhere.
describe("status colour single source of truth", () => {
  it("maps every status to its CSS-var-backed dot class (no bg-* left)", () => {
    for (const status of MC_STATUSES) {
      expect(STATUS_COLOR[status]).toBe(`status-dot--${status.toLowerCase()}`);
    }
  });

  it("emits a --status-<x> CSS var for every status, and only for those", () => {
    const vars = lookAndFeelToCssVars(DEFAULT_LOOK_AND_FEEL);
    for (const status of MC_STATUSES) {
      expect(vars).toHaveProperty(`--status-${status.toLowerCase()}`);
    }
    // The other half of the guard: no var for a status that no longer exists.
    // The SSR emitter used to be a hand-written list, which is how it could
    // both skip a real status and outlive a removed one.
    const emitted = Object.keys(vars).filter((k) => k.startsWith("--status-"));
    expect(emitted.sort()).toEqual(
      MC_STATUSES.map((s) => `--status-${s.toLowerCase()}`).sort(),
    );
  });

  it("gives DRAFT a colour — it is shown on the drafts page", () => {
    const vars = lookAndFeelToCssVars(DEFAULT_LOOK_AND_FEEL);
    expect(vars["--status-draft"]).toBeTruthy();
  });

  it("keeps DRAFT out of the matrix filter — a draft has no cell", () => {
    expect(STATUS_OPTIONS).toEqual(MATRIX_STATUSES);
    expect(STATUS_OPTIONS).not.toContain("DRAFT");
  });
});
