import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { readSessionFromCookies } from "@/lib/auth-server";
import { QueryProvider } from "../_components/QueryProvider";
import AppShell from "../_components/AppShell";
import pkg from "../../../package.json";

function resolveDbUrl(): string {
  return process.env.DATABASE_URL ?? "(DATABASE_URL unset)";
}

// Authed app shell. Anything under /(app)/ requires login + matches active client.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");

  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!u) redirect("/login");

  const client = await getActiveClient();

  const aboutInfo = {
    activeClient: {
      key: client.key,
      name: client.name,
      status: client.status,
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
    <QueryProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <AppShell
          user={{ id: u.id, email: u.email, role: u.role }}
          client={{ key: client.key, name: client.name }}
          aboutInfo={aboutInfo}
        >
          {children}
        </AppShell>
      </div>
    </QueryProvider>
  );
}
