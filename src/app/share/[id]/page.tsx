import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, messages, shareGalleries } from "@/db/schema";
import {
  getLookAndFeelByClientId,
  lookAndFeelToCssVars,
} from "@/lib/branding";

type Message = typeof messages.$inferSelect;

type SnapshotMetadata = {
  generatedAt?: string;
  messages?: Message[];
};

export const dynamic = "force-dynamic";

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const share = db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, id))
    .get();
  if (!share) notFound();

  const client = db
    .select()
    .from(clients)
    .where(eq(clients.id, share.clientId))
    .get();
  if (!client) notFound();

  const meta: SnapshotMetadata = (() => {
    if (!share.metadata) return {};
    try {
      return JSON.parse(share.metadata) as SnapshotMetadata;
    } catch {
      return {};
    }
  })();
  const snapshot = meta.messages ?? [];

  const laf = getLookAndFeelByClientId(client.id);
  const style = lookAndFeelToCssVars(laf) as CSSProperties;

  const generated = meta.generatedAt
    ? new Date(meta.generatedAt).toISOString().slice(0, 10)
    : null;

  return (
    <div
      className="share-gallery min-h-screen bg-slate-50"
      style={style}
    >
      <header className="share-gallery__header bg-brand-primary px-6 py-8 text-white">
        <div className="mx-auto max-w-4xl">
          <p className="share-gallery__client text-xs uppercase tracking-wide opacity-80">
            {client.name}
          </p>
          <h1 className="share-gallery__title mt-1 text-2xl font-semibold">
            {share.title ?? "Untitled share"}
          </h1>
          {share.description ? (
            <p className="share-gallery__description mt-2 max-w-2xl text-sm opacity-90">
              {share.description}
            </p>
          ) : null}
          <p className="share-gallery__meta mt-3 text-xs opacity-75">
            {snapshot.length} message{snapshot.length === 1 ? "" : "s"}
            {generated ? ` · captured ${generated}` : null}
          </p>
        </div>
      </header>

      <main className="share-gallery__main mx-auto max-w-4xl px-6 py-8">
        {snapshot.length === 0 ? (
          <div className="empty-state mx-auto max-w-md rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">
              This share has no messages.
            </p>
          </div>
        ) : (
          <ul className="share-gallery__list space-y-4">
            {snapshot.map((m) => (
              <MessageCard key={m.id} m={m} />
            ))}
          </ul>
        )}
      </main>

      <footer className="share-gallery__footer mx-auto max-w-4xl px-6 py-6 text-center text-xs text-slate-500">
        Shared from {client.name} · MessagingMatrix
      </footer>
    </div>
  );
}

function MessageCard({ m }: { m: Message }) {
  return (
    <li className="share-gallery__card rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="share-gallery__card-header mb-3 flex items-baseline gap-3">
        <span className="share-gallery__mc-id rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700">
          MC{m.number}
          {m.variant}
        </span>
        {m.status ? (
          <span
            className={`status-badge status-badge--${m.status.toLowerCase()}`}
          >
            {m.status}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-slate-400">
          v{m.versionNo}
        </span>
      </div>

      {m.headline ? (
        <h2 className="share-gallery__headline text-lg font-semibold text-slate-900">
          {m.headline}
        </h2>
      ) : null}
      {m.copy1 ? (
        <p className="share-gallery__copy mt-2 text-sm text-slate-700">
          {m.copy1}
        </p>
      ) : null}
      {m.copy2 ? (
        <p className="share-gallery__copy mt-1 text-sm text-slate-700">
          {m.copy2}
        </p>
      ) : null}
      {m.disclaimer ? (
        <p className="share-gallery__disclaimer mt-2 text-xs text-slate-500">
          {m.disclaimer}
        </p>
      ) : null}

      {m.cta ? (
        <div className="share-gallery__cta-row mt-4 flex items-center gap-3">
          <span className="rounded-md bg-brand-button px-3 py-1.5 text-xs font-semibold text-white">
            {m.cta}
          </span>
          {m.landingUrl ? (
            <span className="break-all font-mono text-xs text-slate-500">
              → {m.landingUrl}
            </span>
          ) : null}
        </div>
      ) : null}

      <dl className="share-gallery__facts mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs md:grid-cols-4">
        <Fact k="Audience" v={m.audience} />
        <Fact k="Topic" v={m.topic} />
        <Fact k="Template" v={m.template} />
        <Fact k="PMMID" v={m.pmmid} />
        <Fact k="Start" v={m.startDate} />
        <Fact k="End" v={m.endDate} />
      </dl>
    </li>
  );
}

function Fact({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-400">
        {k}
      </dt>
      <dd className="font-mono text-xs text-slate-700">{v}</dd>
    </div>
  );
}
