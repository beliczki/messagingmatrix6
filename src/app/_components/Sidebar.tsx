"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Table2,
  Image as ImageIcon,
  Package,
  BarChart3,
  FileCode,
  Users as UsersIcon,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

type NavUser = { email: string; role: string };
type NavClient = { key: string; name: string };

const ITEMS: Array<{ href: string; label: string; Icon: typeof Table2; admin?: boolean }> = [
  { href: "/matrix", label: "Matrix", Icon: Table2 },
  { href: "/creative-library", label: "Creative Library", Icon: ImageIcon },
  { href: "/assets", label: "Assets", Icon: Package },
  { href: "/monitoring", label: "Monitoring", Icon: BarChart3 },
  { href: "/templates", label: "Templates", Icon: FileCode },
  { href: "/users", label: "Users", Icon: UsersIcon, admin: true },
  { href: "/settings", label: "Settings", Icon: SettingsIcon, admin: true },
];

export function Sidebar({ user, client }: { user: NavUser; client: NavClient }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside
      className={clsx(
        "flex h-screen flex-col border-r border-slate-200 bg-white transition-all",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div
        className={clsx(
          "flex h-12 shrink-0 items-center gap-2 border-b border-slate-100",
          collapsed ? "justify-center px-2" : "px-3",
        )}
      >
        <button
          aria-label="Toggle sidebar"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-1 hover:bg-slate-100"
        >
          <img src="/mmatrix.svg" alt="Messaging Matrix" className="size-6" />
        </button>
        {!collapsed ? (
          <p className="text-sm font-semibold text-slate-900">{client.name}</p>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {ITEMS.filter((it) => !it.admin || user.role === "admin").map((it) => {
          const active = pathname === it.href || pathname?.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                "mb-0.5 flex items-center rounded-md text-sm font-medium transition",
                collapsed
                  ? "mx-auto size-9 justify-center"
                  : "gap-3 px-2.5 py-2",
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <it.Icon className="size-4 shrink-0" />
              {!collapsed ? <span>{it.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className={clsx("border-t border-slate-100", collapsed ? "p-2" : "p-3")}>
        {!collapsed ? (
          <div className="mb-2 text-xs">
            <p className="truncate font-medium text-slate-700">{user.email}</p>
            <p className="text-slate-500">{user.role}</p>
          </div>
        ) : null}
        <button
          onClick={logout}
          className={clsx(
            "flex items-center rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100",
            collapsed
              ? "mx-auto size-9 justify-center"
              : "w-full gap-2 px-2 py-1.5",
          )}
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>
    </aside>
  );
}
