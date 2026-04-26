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
  Menu,
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
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-100 p-3">
        {!collapsed ? (
          <div className="leading-tight">
            <p className="text-xs uppercase tracking-wider text-slate-500">
              Messaging Matrix
            </p>
            <p className="text-sm font-semibold text-slate-900">{client.name}</p>
          </div>
        ) : null}
        <button
          aria-label="Toggle sidebar"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <Menu className="size-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {ITEMS.filter((it) => !it.admin || user.role === "admin").map((it) => {
          const active = pathname === it.href || pathname?.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                "mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition",
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

      <div className="border-t border-slate-100 p-3">
        {!collapsed ? (
          <div className="mb-2 text-xs">
            <p className="truncate font-medium text-slate-700">{user.email}</p>
            <p className="text-slate-500">{user.role}</p>
          </div>
        ) : null}
        <button
          onClick={logout}
          className={clsx(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100",
            collapsed && "justify-center",
          )}
        >
          <LogOut className="size-4" />
          {!collapsed ? <span>Sign out</span> : null}
        </button>
      </div>
    </aside>
  );
}
