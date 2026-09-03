"use client";

import { Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { useThemeSwitch } from "./useThemeSwitch";

/** The sidebar's light/dark pill, in a size that sits in a toolbar row. Same
 *  state and same view transition — only the chrome differs. */
export default function ThemeToggle({ className }: { className?: string }) {
  const { dark, setTheme } = useThemeSwitch();
  const btn =
    "theme-toggle__btn flex size-6 items-center justify-center rounded-[4px] transition-colors";
  const inactive =
    "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700";
  return (
    <div
      className={clsx(
        "theme-toggle inline-flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800",
        className,
      )}
      role="radiogroup"
      aria-label="Theme"
    >
      <button
        type="button"
        role="radio"
        aria-checked={!dark}
        onClick={(e) => setTheme(false, e)}
        title="Light mode"
        className={clsx(btn, !dark ? "bg-slate-900 text-white" : inactive)}
      >
        <Sun className="size-3.5" />
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={dark}
        onClick={(e) => setTheme(true, e)}
        title="Dark mode"
        className={clsx(btn, dark ? "bg-slate-900 text-white" : inactive)}
      >
        <Moon className="size-3.5" />
      </button>
    </div>
  );
}
