"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { usePresenceConnection } from "./usePresenceConnection";
import UsersDialog from "../(app)/_components/UsersDialog";
import SettingsDialog from "../(app)/_components/SettingsDialog";
import { AlertDialogProvider } from "../(app)/_components/AlertDialog";

type AboutInfo = {
  activeClient: { key: string; name: string; status: string };
  user: { email: string; role: string };
  env: { activeClientKey: string; nodeEnv: string };
  dbPath: string;
  objectStore: string;
  appVersion: string;
};

type Props = {
  user: { id: string; email: string; role: string };
  client: { key: string; name: string };
  aboutInfo: AboutInfo;
  children: ReactNode;
};

export default function AppShell({ user, client, aboutInfo, children }: Props) {
  const [usersOpen, setUsersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  usePresenceConnection();

  const isAdmin = user.role === "admin";

  return (
    <AlertDialogProvider>
      <Sidebar
        user={{ email: user.email, role: user.role }}
        client={client}
        version={aboutInfo.appVersion}
        onOpenUsers={isAdmin ? () => setUsersOpen(true) : undefined}
        onOpenSettings={isAdmin ? () => setSettingsOpen(true) : undefined}
      />
      <main className="flex-1 overflow-auto">{children}</main>

      {isAdmin ? (
        <UsersDialog
          open={usersOpen}
          onClose={() => setUsersOpen(false)}
          currentUserId={user.id}
        />
      ) : null}
      {isAdmin ? (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          activeClient={{ key: client.key, name: client.name }}
          aboutInfo={aboutInfo}
        />
      ) : null}
    </AlertDialogProvider>
  );
}
