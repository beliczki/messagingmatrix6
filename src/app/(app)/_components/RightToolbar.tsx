"use client";

import { useEffect, useState } from "react";
import { PocketKnife } from "lucide-react";
import clsx from "clsx";

type Props = {
  /** localStorage key for persisted open/closed state. */
  storageKey?: string;
  /** Optional title rendered when expanded. */
  title?: string;
  /**
   * Children. As a render-prop function it receives the current `collapsed`
   * state so the parent can render a compact (icon-only) variant when
   * collapsed and a full variant when expanded.
   */
  children?: React.ReactNode | ((collapsed: boolean) => React.ReactNode);
};

export default function RightToolbar({
  storageKey = "mm6_right_toolbar_open",
  title,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v !== null) setCollapsed(v !== "true");
    } catch {}
    setHydrated(true);
  }, [storageKey]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(storageKey, String(!next));
      } catch {}
      return next;
    });
  }

  return (
    <aside
      className={clsx(
        "flex h-full shrink-0 flex-col border-l border-slate-200 bg-white",
        hydrated ? "transition-[width] duration-150" : "",
        collapsed ? "w-12" : "w-64",
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-slate-100 px-2">
        {!collapsed ? (
          <span className="text-sm font-semibold text-slate-900">Toolbar</span>
        ) : null}
        <button
          onClick={toggle}
          aria-label={collapsed ? "Open toolbar" : "Close toolbar"}
          title={collapsed ? "Open toolbar" : "Close toolbar"}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <PocketKnife className="size-5" />
        </button>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {!collapsed && title ? (
          <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {title}
          </div>
        ) : null}
        <div
          className={clsx(
            "flex-1",
            collapsed ? "flex flex-col items-center gap-2 py-2" : "px-3 pb-3 pt-1",
          )}
        >
          {typeof children === "function" ? children(collapsed) : children}
        </div>
      </div>
    </aside>
  );
}
