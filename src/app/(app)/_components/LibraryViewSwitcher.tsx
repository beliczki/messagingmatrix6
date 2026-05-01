"use client";

import { LayoutGrid, List as ListIcon, Columns3, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import CycleIconButton from "./CycleIconButton";

export type LibraryViewMode = "grid" | "list" | "masonry";

type ViewDef = {
  value: LibraryViewMode;
  label: string;
  Icon: LucideIcon;
};

const VIEW_DEFS: ViewDef[] = [
  { value: "grid", label: "Grid", Icon: LayoutGrid },
  { value: "list", label: "List", Icon: ListIcon },
  { value: "masonry", label: "Masonry", Icon: Columns3 },
];

export const LIBRARY_VIEW_CODEC = {
  parse: (s: string): LibraryViewMode =>
    s === "grid" || s === "list" || s === "masonry" ? s : "masonry",
  stringify: (v: LibraryViewMode) => v,
};

export function LibraryViewSwitcher({
  view,
  setView,
  collapsed,
  children,
}: {
  view: LibraryViewMode;
  setView: (v: LibraryViewMode) => void;
  collapsed: boolean;
  /** Optional extra controls rendered inside the VIEW section, below the selector. */
  children?: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <>
        <CycleIconButton
          options={VIEW_DEFS.map(({ value, label, Icon }) => ({
            value,
            label: `${label} view`,
            icon: <Icon className="size-4" />,
          }))}
          value={view}
          onChange={setView}
        />
        {children}
      </>
    );
  }
  return (
    <div className="library-view-switcher">
      <div className="library-view-switcher__label mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        View
      </div>
      <div className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        {VIEW_DEFS.map(({ value, label, Icon }) => (
          <ToggleBtn
            key={value}
            active={view === value}
            onClick={() => setView(value)}
          >
            <Icon className="size-3.5" />
            {label}
          </ToggleBtn>
        ))}
      </div>
      {children ? (
        <div className="library-view-switcher__extra mt-2">{children}</div>
      ) : null}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "toggle-btn flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 transition",
        active
          ? "toggle-btn--active bg-slate-900 text-white"
          : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}
