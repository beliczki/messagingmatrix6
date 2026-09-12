"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/app/_icons/Icon";
import { useState } from "react";
import clsx from "clsx";
import { useThemeSwitch } from "./useThemeSwitch";

type NavUser = { email: string; role: string };

// The nav carries icon NAMES, not components: the family is chosen at render
// time by the icon registry, so a list of components here would pin every nav
// item to lucide for good.
const ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/matrix", label: "Matrix", icon: "table" },
  { href: "/creative-library", label: "Creative Library", icon: "image" },
  { href: "/drafts", label: "Drafts", icon: "flask" },
  { href: "/assets", label: "Assets", icon: "package" },
  { href: "/texts", label: "Texts", icon: "text" },
  { href: "/audiences", label: "Audiences", icon: "users" },
  { href: "/topics", label: "Topics", icon: "tree" },
  { href: "/templates", label: "Templates", icon: "file-code" },
  { href: "/shares", label: "Shares", icon: "share" },
  { href: "/feeds", label: "Feeds", icon: "rss" },
  { href: "/monitoring", label: "Monitoring", icon: "chart" },
];

type Props = {
  user: NavUser;
  /** App version (package.json), shown dimmed under the last nav item. */
  version: string;
  /** Provided when current user is admin; opens the Users dialog. */
  onOpenUsers?: () => void;
  /** Provided when current user is admin; opens the Settings dialog. */
  onOpenSettings?: () => void;
};

export function Sidebar({ user, version, onOpenUsers, onOpenSettings }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Light/dark toggle — shared with the public share page (useThemeSwitch).
  const { dark, setTheme } = useThemeSwitch();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const bottomBtnClass = clsx(
    "app-sidebar__bottom-btn flex items-center rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100",
    collapsed ? "mx-auto size-9 justify-center" : "w-full gap-2 px-2 py-1.5",
  );

  return (
    <aside
      className={clsx(
        "app-sidebar flex h-screen flex-col border-r border-slate-200 bg-white transition-all",
        collapsed ? "app-sidebar--collapsed w-14" : "w-64",
      )}
    >
      <div
        className={clsx(
          "app-sidebar__brand flex h-12 shrink-0 items-center gap-2 border-b border-slate-100",
          collapsed ? "justify-center px-2" : "px-3",
        )}
      >
        <button
          aria-label="Toggle sidebar"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-1 hover:bg-slate-100"
        >
          <img src="/mmatrix.svg" alt="Messaging Matrix" className="app-sidebar__logo size-6 dark:hidden" />
          <img src="/mmatrix-dark.svg" alt="" aria-hidden className="app-sidebar__logo app-sidebar__logo--dark size-6 hidden dark:block" />
        </button>
      </div>

      <nav className="app-sidebar__nav flex-1 overflow-y-auto p-2">
        {ITEMS.map((it) => {
          // The root is exact-match only: `startsWith("/")` would light the
          // Dashboard item up on every screen in the app.
          const active =
            it.href === "/"
              ? pathname === "/"
              : pathname === it.href || pathname?.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                "app-sidebar__nav-link mb-0.5 flex items-center rounded-md text-sm font-medium transition",
                collapsed
                  ? "mx-auto size-9 justify-center"
                  : "gap-3 px-2.5 py-2",
                active
                  ? "app-sidebar__nav-link--active bg-brand-primary text-white"
                  : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <Icon name={it.icon} className="app-sidebar__nav-icon size-4 shrink-0" />
              {!collapsed ? <span className="app-sidebar__nav-label">{it.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div
        className={clsx(
          "app-sidebar__footer flex flex-col gap-0.5 border-t border-slate-100 pb-12",
          collapsed ? "p-2 pb-12" : "p-3 pb-12",
        )}
      >
        <div className="app-sidebar__theme mb-3">
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              {/* rotated version — the outer span reserves layout height (CSS
                  rotate does not), the inner is turned 90° CCW so it reads
                  bottom-to-top without overflowing the 56px rail. */}
              <span className="app-sidebar__version flex h-11 w-full items-center justify-center">
                <span
                  className="-rotate-90 whitespace-nowrap font-mono text-[10px] leading-none text-slate-500"
                  title={`Version ${version}`}
                >
                  v{version}
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => setTheme(!dark, e)}
                title={dark ? "Light mode" : "Dark mode"}
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                className="app-sidebar__theme-round flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
              >
                {dark ? <Icon name="sun" className="size-3.5" /> : <Icon name="moon" className="size-3.5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="app-sidebar__theme-pill inline-flex rounded-md border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-800"
                role="radiogroup"
                aria-label="Theme"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!dark}
                  onClick={(e) => setTheme(false, e)}
                  title="Light mode"
                  className={clsx(
                    "app-sidebar__theme-btn flex size-6 items-center justify-center rounded-[4px] transition-colors",
                    !dark
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700",
                  )}
                >
                  <Icon name="sun" className="size-3.5" />
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={dark}
                  onClick={(e) => setTheme(true, e)}
                  title="Dark mode"
                  className={clsx(
                    "app-sidebar__theme-btn flex size-6 items-center justify-center rounded-[4px] transition-colors",
                    dark
                      ? "bg-slate-900 text-white"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700",
                  )}
                >
                  <Icon name="moon" className="size-3.5" />
                </button>
              </div>
              <span
                className="app-sidebar__version font-mono text-[10px] text-slate-500"
                title={`Version ${version}`}
              >
                v{version}
              </span>
            </div>
          )}
        </div>

        {!collapsed ? (
          <div className="app-sidebar__user mb-2 text-xs">
            <p className="truncate font-medium text-slate-700">{user.email}</p>
            <p className="text-slate-500">{user.role}</p>
          </div>
        ) : null}
        {onOpenUsers ? (
          <button
            type="button"
            onClick={onOpenUsers}
            className={bottomBtnClass}
            title="Users"
            aria-label="Open Users"
          >
            <Icon name="users" className="size-4" />
            {!collapsed ? <span>Users</span> : null}
          </button>
        ) : null}
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className={bottomBtnClass}
            title="Settings"
            aria-label="Open Settings"
          >
            <Icon name="settings" className="size-4" />
            {!collapsed ? <span>Settings</span> : null}
          </button>
        ) : null}
        <button
          onClick={logout}
          className={clsx(bottomBtnClass, "app-sidebar__logout")}
          title="Sign out"
          aria-label="Sign out"
        >
          <Icon name="logout" className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>
    </aside>
  );
}
