"use client";

import { createContext, useContext, type ReactNode } from "react";

export type BrandInfo = {
  clientName: string;
  /** Cobranding logo, when the tenant enabled one — otherwise the name shows. */
  logoUrl: string | null;
};

const BrandContext = createContext<BrandInfo>({
  clientName: "",
  logoUrl: null,
});

export function BrandProvider({
  value,
  children,
}: {
  value: BrandInfo;
  children: ReactNode;
}) {
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/**
 * Who this deploy belongs to, at the head of every page toolbar, before the
 * page name. It used to sit in the sidebar's brand strip
 * next to the product logo, where it doubled as the way back to the dashboard;
 * the dashboard has its own nav item now, so this is identity only, not a link.
 *
 * It renders as a direct child of the toolbar, not inside the title's
 * `items-baseline` group: at 1.7rem the logo is taller than the text, and a
 * baseline group grows with its tallest member — the page name would have been
 * pushed to the top of the row. As a toolbar-level item the toolbar's own
 * `items-center` keeps the logo and everything after it on the same middle.
 *
 * The cobranding logos are shipped as a single white-filled SVG per tenant
 * (public/erste.svg, public/telekom.svg). CSS cannot reach inside an <img>, so
 * light mode inverts the whole file — white becomes black, and the transparent
 * ground stays transparent because a filter rewrites colour channels, not
 * alpha. Dark mode takes the file as it is. That only holds for a monochrome
 * mark; a multi-colour logo would need its own light/dark pair.
 */
export function AppBrandTag() {
  const brand = useContext(BrandContext);
  if (!brand.clientName && !brand.logoUrl) return null;
  return (
    <span className="app-brand-tag flex shrink-0 items-center gap-2 self-center">
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          alt={brand.clientName}
          className="app-brand-tag__logo h-[1.7rem] w-auto max-w-40 object-contain invert dark:invert-0"
        />
      ) : (
        <span className="app-brand-tag__name text-sm font-semibold text-text-primary">
          {brand.clientName}
        </span>
      )}
    </span>
  );
}
