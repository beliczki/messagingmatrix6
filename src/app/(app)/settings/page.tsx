import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { getActiveClient } from "@/lib/active-client";
import { SettingsView } from "./SettingsView";
import pkg from "../../../../package.json";

function resolveDbUrl(): string {
  return process.env.DATABASE_URL ?? "(DATABASE_URL unset)";
}

// Object-store backend, no secret. S3 mode shows bucket + endpoint (incl. port);
// otherwise the local-disk fallback path.
function resolveObjectStore(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return `local disk (${process.env.STORAGE_ROOT ?? "./storage"})`;
  return `${bucket} @ ${process.env.S3_ENDPOINT ?? "(default AWS endpoint)"}`;
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
    objectStore: resolveObjectStore(),
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
