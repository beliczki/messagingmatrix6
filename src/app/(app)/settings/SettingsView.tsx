"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { DesignTab } from "./_design/DesignTab";
import { ClientsTab } from "./_clients/ClientsTab";
import { StorageTab } from "./_storage/StorageTab";
import { StructureTab } from "./_structure/StructureTab";
import { KeywordsTab } from "./_keywords/KeywordsTab";
import { ChannelsTab } from "./_channels/ChannelsTab";
import { SnapshotsTab } from "./_snapshots/SnapshotsTab";
import { ChangelogTab } from "./_changelog/ChangelogTab";
import { McpTab } from "./_mcp/McpTab";
import { AboutTab } from "./_about/AboutTab";

type TabKey =
  | "clients"
  | "design"
  | "storage"
  | "structure"
  | "keywords"
  | "channels"
  | "snapshots"
  | "changelog"
  | "mcp"
  | "about";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "clients", label: "Clients" },
  { key: "design", label: "Design" },
  { key: "storage", label: "Storage" },
  { key: "structure", label: "Structure" },
  { key: "keywords", label: "Keywords" },
  { key: "channels", label: "Channels" },
  { key: "snapshots", label: "Snapshots" },
  { key: "changelog", label: "Changelog" },
  { key: "mcp", label: "MCP" },
  { key: "about", label: "About" },
];

type ActiveClient = { key: string; name: string };

type AboutInfo = {
  activeClient: { key: string; name: string; status: string };
  user: { email: string; role: string };
  env: { activeClientKey: string; nodeEnv: string };
  dbPath: string;
  objectStore: string;
  appVersion: string;
};

const SettingsActionsSlotContext = createContext<HTMLDivElement | null>(null);

export function SettingsHeaderActions({ children }: { children: ReactNode }) {
  const slot = useContext(SettingsActionsSlotContext);
  if (!slot) return null;
  return createPortal(children, slot);
}

export function SettingsView({
  activeClient,
  aboutInfo,
  inDialog = false,
}: {
  activeClient: ActiveClient;
  aboutInfo: AboutInfo;
  /** When rendered inside AppDialog, leave room for the floating X close button. */
  inDialog?: boolean;
}) {
  const [active, setActive] = useState<TabKey>("design");
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  const activeLabel = TABS.find((t) => t.key === active)?.label ?? "";

  return (
    <SettingsActionsSlotContext.Provider value={actionsSlot}>
      <div className="settings__container flex h-full w-full flex-col">
        <header
          className={clsx(
            "settings__header toolbar flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4",
            inDialog && "pr-12",
          )}
        >
          <h1 className="settings__title text-lg font-semibold text-slate-900">
            Settings
            <span className="settings__title-divider mx-2 text-slate-300">
              ·
            </span>
            <span className="settings__title-tab text-slate-600">
              {activeLabel}
            </span>
          </h1>
          <div
            ref={setActionsSlot}
            className="settings__header-actions flex items-center gap-2"
          />
        </header>
        <nav className="settings__tab-bar tab-bar flex h-10 shrink-0 items-stretch gap-1 border-b border-slate-200 bg-white px-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={clsx(
                "tab-bar__tab -mb-px flex items-center border-b-2 px-3 text-sm font-medium transition",
                active === t.key
                  ? "tab-bar__tab--active border-brand-primary text-brand-primary"
                  : "border-transparent text-slate-600 hover:text-slate-900",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings__content flex-1 overflow-auto p-6">
          {active === "design" ? (
            <DesignTab />
          ) : active === "clients" ? (
            <ClientsTab activeClient={activeClient} />
          ) : active === "storage" ? (
            <StorageTab />
          ) : active === "structure" ? (
            <StructureTab />
          ) : active === "keywords" ? (
            <KeywordsTab />
          ) : active === "channels" ? (
            <ChannelsTab />
          ) : active === "snapshots" ? (
            <SnapshotsTab />
          ) : active === "changelog" ? (
            <ChangelogTab />
          ) : active === "mcp" ? (
            <McpTab />
          ) : (
            <AboutTab info={aboutInfo} />
          )}
        </div>
      </div>
    </SettingsActionsSlotContext.Provider>
  );
}
