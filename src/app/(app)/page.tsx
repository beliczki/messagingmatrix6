import { redirect } from "next/navigation";
import { eq, desc, count } from "drizzle-orm";
import { db } from "@/db";
import {
  audiences,
  auditLog,
  assets,
  creatives,
  messages,
  textFormatting,
  topics,
} from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { readSessionFromCookies } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

async function entityCounts(clientId: number) {
  const c = await Promise.all([
    db.select({ n: count() }).from(audiences).where(eq(audiences.clientId, clientId)),
    db.select({ n: count() }).from(topics).where(eq(topics.clientId, clientId)),
    db.select({ n: count() }).from(messages).where(eq(messages.clientId, clientId)),
    db.select({ n: count() }).from(assets).where(eq(assets.clientId, clientId)),
    db.select({ n: count() }).from(creatives).where(eq(creatives.clientId, clientId)),
    db.select({ n: count() }).from(textFormatting).where(eq(textFormatting.clientId, clientId)),
  ]);
  return {
    audiences: c[0][0]?.n ?? 0,
    topics: c[1][0]?.n ?? 0,
    messages: c[2][0]?.n ?? 0,
    assets: c[3][0]?.n ?? 0,
    creatives: c[4][0]?.n ?? 0,
    text_formatting: c[5][0]?.n ?? 0,
  };
}

function recentActivity(clientId: number) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.clientId, clientId))
    .orderBy(desc(auditLog.id))
    .limit(15);
}

export default async function Dashboard() {
  // Defense-in-depth: layout already enforces auth, but a direct hit here
  // without the layout (rare) would bypass it.
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");

  const client = await getActiveClient();
  const counts = await entityCounts(client.id);
  const activity = await recentActivity(client.id);

  const cards: Array<[string, number, string]> = [
    ["Audiences", counts.audiences, "/matrix"],
    ["Topics", counts.topics, "/matrix"],
    ["Messages", counts.messages, "/matrix"],
    ["Assets", counts.assets, "/assets"],
    ["Creatives", counts.creatives, "/creative-library"],
    ["Text formatting", counts.text_formatting, "/matrix"],
  ];

  return (
    <div className="p-8">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Dashboard
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">
          {client.name}
          <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-slate-600">
            {client.key}
          </span>
        </h1>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map(([label, n, href]) => (
          <a
            key={label}
            href={href}
            className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-400"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">{n}</p>
          </a>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="text-sm text-slate-500">
            No audit entries yet. Open Matrix and add an audience or message to
            see one show up here.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {activity.map((row) => (
              <li key={row.id} className="flex items-baseline gap-3 py-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    row.action === "create"
                      ? "bg-emerald-100 text-emerald-800"
                      : row.action === "update"
                        ? "bg-blue-100 text-blue-800"
                        : row.action === "delete"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {row.action}
                </span>
                <span className="font-mono text-slate-500">
                  {row.entityType}#{row.entityId}
                </span>
                <span className="text-slate-400">{row.userId ?? "—"}</span>
                <span className="ml-auto text-xs text-slate-400">
                  {row.createdAt}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
