"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Table2,
  Image as ImageIcon,
  Package,
  BarChart3,
  FileCode,
  FlaskConical,
  Users as UsersIcon,
  ListTree,
  Settings as SettingsIcon,
  Share2,
  Rss,
  Type,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import clsx from "clsx";

type NavUser = { email: string; role: string };
type NavClient = { key: string; name: string };
type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const ITEMS: Array<{ href: string; label: string; Icon: IconType }> = [
  { href: "/matrix", label: "Matrix", Icon: Table2 },
  { href: "/creative-library", label: "Creative Library", Icon: ImageIcon },
  { href: "/drafts", label: "Drafts", Icon: FlaskConical },
  { href: "/assets", label: "Assets", Icon: Package },
  { href: "/texts", label: "Texts", Icon: Type },
  { href: "/audiences", label: "Audiences", Icon: UsersIcon },
  { href: "/topics", label: "Topics", Icon: ListTree },
  { href: "/templates", label: "Templates", Icon: FileCode },
  { href: "/shares", label: "Shares", Icon: Share2 },
  { href: "/feeds", label: "Feeds", Icon: Rss },
  { href: "/monitoring", label: "Monitoring", Icon: BarChart3 },
];

type Props = {
  user: NavUser;
  client: NavClient;
  /** App version (package.json), shown dimmed under the last nav item. */
  version: string;
  /** Provided when current user is admin; opens the Users dialog. */
  onOpenUsers?: () => void;
  /** Provided when current user is admin; opens the Settings dialog. */
  onOpenSettings?: () => void;
};

export function Sidebar({ user, client, version, onOpenUsers, onOpenSettings }: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Light/dark toggle — per-browser, mirrors the existing mm6_theme mechanism
  // (localStorage + a `.dark` class on <html>, set pre-hydration by the inline
  // script in the root layout). Light/dark only; "system" is dropped. Init from
  // the class the inline script already applied to avoid a hydration flash.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function setTheme(next: boolean, e?: React.MouseEvent) {
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
    // API freezes the current page as a static snapshot and paints the new theme
    // under a circle that grows from where you clicked to cover the viewport
    // (see the ::view-transition rules + --theme-switch-x/y in globals.css).
    if (e) {
      root.style.setProperty("--theme-switch-x", `${e.clientX}px`);
      root.style.setProperty("--theme-switch-y", `${e.clientY}px`);
    }
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && typeof doc.startViewTransition === "function") {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  }

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
        {!collapsed ? (
          <p className="app-sidebar__client-name text-sm font-semibold text-slate-900">{client.name}</p>
        ) : null}
      </div>

      <nav className="app-sidebar__nav flex-1 overflow-y-auto p-2">
        {ITEMS.map((it) => {
          const active = pathname === it.href || pathname?.startsWith(it.href + "/");
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
              <it.Icon className="app-sidebar__nav-icon size-4 shrink-0" />
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
                {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
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
                  <Sun className="size-3.5" />
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
                  <Moon className="size-3.5" />
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
            <UsersIcon className="size-4" />
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
            <SettingsIcon className="size-4" />
            {!collapsed ? <span>Settings</span> : null}
          </button>
        ) : null}
        <button
          onClick={logout}
          className={clsx(bottomBtnClass, "app-sidebar__logout")}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>
    </aside>
  );
}
