import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { readSessionFromCookies } from "@/lib/auth-server";
import { QueryProvider } from "../_components/QueryProvider";
import { Sidebar } from "../_components/Sidebar";

// Authed app shell. Anything under /(app)/ requires login + matches active client.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");

  const u = db.select().from(users).where(eq(users.id, claims.sub)).get();
  if (!u) redirect("/login");

  const client = getActiveClient();

  return (
    <QueryProvider>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar
          user={{ email: u.email, role: u.role }}
          client={{ key: client.key, name: client.name }}
        />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </QueryProvider>
  );
}
