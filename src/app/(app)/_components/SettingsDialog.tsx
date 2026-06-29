"use client";

import AppDialog from "./AppDialog";
import { SettingsView } from "../settings/SettingsView";

type ActiveClient = { key: string; name: string };
type AboutInfo = {
  activeClient: { key: string; name: string; status: string };
  user: { email: string; role: string };
  env: { activeClientKey: string; nodeEnv: string };
  dbPath: string;
  objectStore: string;
  appVersion: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  activeClient: ActiveClient;
  aboutInfo: AboutInfo;
};

export default function SettingsDialog({
  open,
  onClose,
  activeClient,
  aboutInfo,
}: Props) {
  return (
    <AppDialog open={open} onClose={onClose} ariaLabel="Settings">
      <div className="settings-dialog flex h-full flex-col">
        <SettingsView
          activeClient={activeClient}
          aboutInfo={aboutInfo}
          inDialog
        />
      </div>
    </AppDialog>
  );
}
