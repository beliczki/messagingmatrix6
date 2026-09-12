import { describe, it, expect } from "vitest";
import { LUCIDE_ICONS } from "@/app/_icons/families/lucide";
import { CORE_LINE_ICONS } from "@/app/_icons/families/core-line";
import { CORE_MAP } from "@/app/_icons/core-map";
import { asIconSet, ICON_SETS } from "@/app/_icons/types";

describe("icon registry", () => {
  it("keeps the generated Core family in step with the map it is generated from", () => {
    // core-line.tsx is committed so the box builds without network. That makes
    // a stale generated file possible: edit core-map.ts, forget `npx tsx
    // scripts/gen-icons.ts`, and the new icon silently renders as lucide.
    expect(Object.keys(CORE_LINE_ICONS).sort()).toEqual(
      Object.keys(CORE_MAP).sort(),
    );
  });

  it("never lets a family name something the default family cannot draw", () => {
    const lucide = new Set(Object.keys(LUCIDE_ICONS));
    for (const name of Object.keys(CORE_LINE_ICONS)) {
      expect(lucide.has(name)).toBe(true);
    }
  });

  it("leaves the glyphs Core free does not ship to lucide", () => {
    // Study §3.5: no chevron, no spinner, no grip dots, no 3×3 grid in Core
    // free — and those are the most-used icons in the app. Their absence here
    // is the decision, not a gap someone should fill in by guessing.
    for (const missing of [
      "chevron-right",
      "chevron-left",
      "chevron-down",
      "chevron-up",
      "spinner",
      "grip",
      "grip-vertical",
      "grip-horizontal",
      "grid",
      "code",
      "image-off",
      "check-circle",
    ]) {
      expect(CORE_MAP).not.toHaveProperty(missing);
      expect(LUCIDE_ICONS).toHaveProperty(missing);
    }
  });

  it("falls back to lucide for a stored value no family answers to", () => {
    // lookAndFeel is free-form JSON in the config table: a hand-edited row or
    // a family we later remove must not render an empty toolbar.
    expect(asIconSet("core-pop")).toBe("lucide");
    expect(asIconSet(undefined)).toBe("lucide");
    expect(asIconSet(null)).toBe("lucide");
    for (const set of ICON_SETS) expect(asIconSet(set)).toBe(set);
  });
});
