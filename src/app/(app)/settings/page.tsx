import path from "node:path";
import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { getActiveClient } from "@/lib/active-client";
import { SettingsView } from "./SettingsView";
import pkg from "../../../../package.json";

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return path.resolve(process.cwd(), "db", "matrix.db");
  return url.replace(/^file:/, "");
}

export default async function Page() {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  if (claims.role !== "admin") redirect("/");
  const active = getActiveClient();

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
    dbPath: resolveDbPath(),
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
