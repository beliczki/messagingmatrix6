import { describe, it, expect } from "vitest";
import { FONT_OPTIONS, fontStack } from "@/lib/fonts";
import { DEFAULT_LOOK_AND_FEEL } from "@/db/defaults";

// The stack used to be assembled inline as `"${fontFamily}", system-ui,
// sans-serif` in two places. Now one function answers, and the case that
// matters is the value that is NOT in the dropdown: a face typed into the old
// free-text field must keep rendering as it did, not snap back to the default.
describe("fontStack", () => {
  it("returns the shipped stack for a known family", () => {
    expect(fontStack("TeleNeo")).toBe(
      `"TeleNeo", system-ui, -apple-system, "Segoe UI", sans-serif`,
    );
  });

  it("keeps an unknown, hand-typed family first in the stack", () => {
    expect(fontStack("Helvetica Neue")).toContain(`"Helvetica Neue", `);
  });

  it("falls back to the system stack for an empty value", () => {
    expect(fontStack("")).not.toContain(`""`);
    expect(fontStack("   ")).toBe(fontStack(""));
  });

  it("ships a face for the default fontFamily", () => {
    // A default naming a family the app does not load is exactly the bug this
    // slice fixes — every screen fell through to system-ui while the setting
    // claimed Inter.
    expect(FONT_OPTIONS.map((f) => f.value)).toContain(
      DEFAULT_LOOK_AND_FEEL.fontFamily,
    );
  });
});
