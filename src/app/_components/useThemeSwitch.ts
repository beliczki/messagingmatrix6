"use client";

import { useEffect, useState } from "react";

// Light/dark switching, shared by the app sidebar and the public share page.
// Per-browser: localStorage `mm6_theme` plus a `.dark` class on <html>, which
// the root layout's inline script already applied before hydration — so the
// initial state is read from the class, not from storage, to avoid a flash.
export function useThemeSwitch() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function setTheme(next: boolean, e?: { clientX: number; clientY: number }) {
    const apply = () => {
      setDark(next);
      document.documentElement.classList.toggle("dark", next);
      try {
        localStorage.setItem("mm6_theme", next ? "dark" : "light");
      } catch {
        // ignore storage failures
      }
    };
    const root = document.documentElement;
    // Concentric-circle reveal centred on the click point: the View Transitions
    // API freezes the current page as a static snapshot and paints the new
    // theme under a circle growing from where you clicked (see the
    // ::view-transition rules + --theme-switch-x/y in globals.css).
    if (e) {
      root.style.setProperty("--theme-switch-x", `${e.clientX}px`);
      root.style.setProperty("--theme-switch-y", `${e.clientY}px`);
    }
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof doc.startViewTransition === "function") {
      // A transition can be skipped (another one running, the document not
      // visible) — the update callback still runs, so the theme applies either
      // way and only the animation is lost. Without this the skipped promise
      // surfaces as an uncaught InvalidStateError in the console.
      const transition = doc.startViewTransition(apply) as {
        finished?: Promise<unknown>;
      };
      transition?.finished?.catch(() => {});
    } else {
      apply();
    }
  }

  return { dark, setTheme };
}
