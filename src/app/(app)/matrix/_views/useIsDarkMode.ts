"use client";

import { useEffect, useState } from "react";

// Tracks the `dark` class on <html> (toggled by DesignTab + the inline init
// script in layout.tsx). Used by the tree view + its navigator to swap
// MiniMap/Controls colors that would otherwise be invisible on dark bg.
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}
