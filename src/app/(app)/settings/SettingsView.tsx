"use client";

import { useState } from "react";
import clsx from "clsx";
import { DesignTab } from "./_design/DesignTab";
import { ClientsTab } from "./_clients/ClientsTab";
import { StorageTab } from "./_storage/StorageTab";
import { StructureTab } from "./_structure/StructureTab";
import { SnapshotsTab } from "./_snapshots/SnapshotsTab";
import { ChangelogTab } from "./_changelog/ChangelogTab";
import { AboutTab } from "./_about/AboutTab";

type TabKey =
  | "clients"
  | "design"
  | "storage"
  | "structure"
  | "snapshots"
  | "changelog"
  | "about";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "clients", label: "Clients" },
  { key: "design", label: "Design" },
  { key: "storage", label: "Storage" },
  { key: "structure", label: "Structure" },
  { key: "snapshots", label: "Snapshots" },
  { key: "changelog", label: "Changelog" },
  { key: "about", label: "About" },
];

type ActiveClient = { key: string; name: string };

type AboutInfo = {
  activeClient: { key: string; name: string; status: string };
  user: { email: string; role: string };
  env: { activeClientKey: string; nodeEnv: string };
  dbPath: string;
  appVersion: string;
};

export function SettingsView({
  activeClient,
  aboutInfo,
}: {
  activeClient: ActiveClient;
  aboutInfo: AboutInfo;
}) {
  const [active, setActive] = useState<TabKey>("design");

  return (
    <div className="settings__container flex h-full w-full flex-col">
      <nav className="settings__tab-bar tab-bar flex h-12 shrink-0 items-stretch gap-1 border-b border-slate-200 bg-white px-4">
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
        ) : active === "snapshots" ? (
          <SnapshotsTab />
        ) : active === "changelog" ? (
          <ChangelogTab />
        ) : (
          <AboutTab info={aboutInfo} />
        )}
      </div>
    </div>
  );
}
