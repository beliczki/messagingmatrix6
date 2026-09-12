import type { ComponentType, SVGProps } from "react";

/**
 * Every family renders the same shape: an SVG component that takes className
 * and colours itself from currentColor. lucide's own components accept more
 * (size, strokeWidth, absoluteStrokeWidth); the registry deliberately does not
 * pass those through, because a generated Core icon has no equivalent. The one
 * lucide-specific prop the app used, strokeWidth={3}, becomes <Icon bold />.
 */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Icon families a tenant can pick. Stored in lookAndFeel.iconSet. */
export const ICON_SETS = [
  "lucide",
  "core-line",
  "core-solid",
  "core-remix",
  "core-pop",
] as const;
export type IconSet = (typeof ICON_SETS)[number];

/** Unknown stored values (a hand-edited config, a family we removed) fall back
 *  to the default rather than rendering nothing. */
export function asIconSet(value: unknown): IconSet {
  return (ICON_SETS as readonly string[]).includes(value as string)
    ? (value as IconSet)
    : "lucide";
}
