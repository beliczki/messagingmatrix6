import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { getActiveLookAndFeel } from "@/lib/branding";
import { readSessionFromCookies } from "@/lib/auth-server";
import { QueryProvider } from "../_components/QueryProvider";
import AppShell from "../_components/AppShell";
import pkg from "../../../package.json";

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
  // The cobranding logo replaces the client name in every page toolbar. It is
  // resolved here, server-side, for the same reason the brand CSS variables
  // are: a client-side fetch would paint the name first and swap it under the
  // user on every navigation.
  const laf = await getActiveLookAndFeel();
  const cobrandLogoUrl =
    laf.cobranding.enabled && laf.cobranding.logoUrl
      ? laf.cobranding.logoUrl
      : null;

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
    objectStore: resolveObjectStore(),
    appVersion: pkg.version,
  };

  return (
    <QueryProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <AppShell
          user={{ id: u.id, email: u.email, role: u.role }}
          client={{ key: client.key, name: client.name }}
          cobrandLogoUrl={cobrandLogoUrl}
          aboutInfo={aboutInfo}
        >
          {children}
        </AppShell>
      </div>
    </QueryProvider>
  );
}
