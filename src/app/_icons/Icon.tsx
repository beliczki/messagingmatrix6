"use client";

import { createContext, useContext, type ReactNode, type SVGProps } from "react";
import clsx from "clsx";
import { LUCIDE_ICONS } from "./families/lucide";
import type { IconComponent } from "./types";

/** Every semantic name the app can draw. Derived from the default family, so
 *  the two can never disagree about which names exist. */
export type IconName = keyof typeof LUCIDE_ICONS;

/** Families the tenant can pick. Grows as generated Core families land. */
export type IconSet = "lucide";

/** A non-default family covers what it covers; the rest falls back to lucide. */
export type IconFamily = Partial<Record<IconName, IconComponent>>;

const FAMILIES: Record<IconSet, IconFamily> = {
  lucide: LUCIDE_ICONS,
};

const IconSetContext = createContext<IconSet>("lucide");

export function IconSetProvider({
  value,
  children,
}: {
  value: IconSet;
  children: ReactNode;
}) {
  return (
    <IconSetContext.Provider value={value}>{children}</IconSetContext.Provider>
  );
}

export function useIconSet(): IconSet {
  return useContext(IconSetContext);
}

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  /**
   * The heavier stroke the app uses on a "selected" check. lucide takes it as
   * strokeWidth; a generated Core icon has no such prop, so the class is what
   * the family CSS hangs off. Both are set — whichever the family understands.
   */
  bold?: boolean;
};

export function Icon({ name, bold, className, ...rest }: IconProps) {
  const set = useIconSet();
  // Falls back to lucide for a name the chosen family does not cover — the
  // twelve icons no Core set ships (chevrons, spinner, grips) live here
  // permanently, not as an accident.
  const Cmp = FAMILIES[set][name] ?? LUCIDE_ICONS[name];
  return (
    <Cmp
      {...rest}
      strokeWidth={bold ? 3 : undefined}
      className={clsx("icon", bold && "icon--bold", className)}
    />
  );
}
