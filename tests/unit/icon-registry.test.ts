import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { LUCIDE_ICONS } from "@/app/_icons/families/lucide";
import { CORE_LINE_ICONS } from "@/app/_icons/families/core-line";
import { CORE_SOLID_ICONS } from "@/app/_icons/families/core-solid";
import { CORE_REMIX_ICONS } from "@/app/_icons/families/core-remix";
import { CORE_POP_ICONS } from "@/app/_icons/families/core-pop";
import { CORE_MAP } from "@/app/_icons/core-map";
import { asIconSet, ICON_SETS } from "@/app/_icons/types";

describe("icon registry", () => {
  it("keeps the generated Core families in step with the map they come from", () => {
    // The families are committed so the box builds without network, which
    // makes a stale file possible: edit core-map.ts, forget `npx tsx
    // scripts/gen-icons.ts`, and the new icon silently renders as lucide.
    // Line and Solid cover the map exactly; Remix and Pop are allowed to be
    // short (Core ships no Remix for arrow-round-left, no Pop for five more),
    // but never longer, and never a name the map does not carry.
    const mapped = new Set(Object.keys(CORE_MAP));
    expect(Object.keys(CORE_LINE_ICONS).sort()).toEqual([...mapped].sort());
    expect(Object.keys(CORE_SOLID_ICONS).sort()).toEqual([...mapped].sort());
    for (const family of [CORE_REMIX_ICONS, CORE_POP_ICONS]) {
      const names = Object.keys(family);
      expect(names.length).toBeGreaterThan(60);
      for (const name of names) expect(mapped.has(name)).toBe(true);
    }
  });

  it("never lets a family name something the default family cannot draw", () => {
    const lucide = new Set(Object.keys(LUCIDE_ICONS));
    for (const family of [
      CORE_LINE_ICONS,
      CORE_SOLID_ICONS,
      CORE_REMIX_ICONS,
      CORE_POP_ICONS,
    ]) {
      for (const name of Object.keys(family)) expect(lucide.has(name)).toBe(true);
    }
  });

  it("rewrites Pop's fixed navy to the themeable ink variable", () => {
    // Pop is the one family that is not currentColor. If the generator ever
    // stops substituting, the icons go invisible on a dark surface instead of
    // looking slightly off — a failure worth catching in CI, not in the dark.
    const source = readFileSync(
      "src/app/_icons/families/core-pop.tsx",
      "utf8",
    );
    expect(source).toContain("var(--icon-ink)");
    expect(source).not.toContain("#0c098c");
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
    expect(asIconSet("core-duo")).toBe("lucide");
    expect(asIconSet(undefined)).toBe("lucide");
    expect(asIconSet(null)).toBe("lucide");
    for (const set of ICON_SETS) expect(asIconSet(set)).toBe(set);
  });
});
