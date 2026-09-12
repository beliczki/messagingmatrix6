import type { ComponentType, SVGProps } from "react";

/**
 * Every family renders the same shape: an SVG component that takes className
 * and colours itself from currentColor. lucide's own components accept more
 * (size, strokeWidth, absoluteStrokeWidth); the registry deliberately does not
 * pass those through, because a generated Core icon has no equivalent. The one
 * lucide-specific prop the app used, strokeWidth={3}, becomes <Icon bold />.
 */
export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
