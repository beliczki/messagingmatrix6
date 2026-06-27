import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { getActiveClient } from "@/lib/active-client";
import { SettingsView } from "./SettingsView";
import pkg from "../../../../package.json";

function resolveDbUrl(): string {
  return process.env.DATABASE_URL ?? "(DATABASE_URL unset)";
}

export default async function Page() {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  if (claims.role !== "admin") redirect("/");
  const active = await getActiveClient();

  const aboutInfo = {
    activeClient: {
      key: active.key,
      name: active.name,
      status: active.status,
    },
    user: { email: claims.email, role: claims.role },
    env: {
      activeClientKey: process.env.ACTIVE_CLIENT_KEY ?? "(unset)",
      nodeEnv: process.env.NODE_ENV ?? "(unset)",
    },
    dbPath: resolveDbUrl(),
    appVersion: pkg.version,
  };

  return (
    <div className="settings flex h-full">
      <SettingsView
        activeClient={{ key: active.key, name: active.name }}
        aboutInfo={aboutInfo}
      />
    </div>
  );
}
