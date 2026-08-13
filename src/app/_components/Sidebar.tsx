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
} from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";
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
        <p
          className={clsx(
            "app-sidebar__version mt-1.5 select-none text-[10px] font-medium text-slate-400",
            collapsed ? "text-center" : "px-2.5",
          )}
          title={`Version ${version}`}
        >
          v{version}
        </p>
      </nav>

      <div
        className={clsx(
          "app-sidebar__footer flex flex-col gap-0.5 border-t border-slate-100 pb-12",
          collapsed ? "p-2 pb-12" : "p-3 pb-12",
        )}
      >
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
