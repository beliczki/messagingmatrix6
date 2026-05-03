import type { CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { clients, creatives, messages, shareGalleries } from "@/db/schema";
import {
  getLookAndFeelByClientId,
  lookAndFeelToCssVars,
} from "@/lib/branding";
import ShareGallery, {
  type SnapshotCreative,
  type SnapshotFile,
  type SnapshotMatrixItem,
  type SnapshotMessage,
} from "./ShareGallery";

type SnapshotMetadata = {
  generatedAt?: string;
  messages?: SnapshotMessage[];
  matrixItems?: SnapshotMatrixItem[];
  creatives?: SnapshotCreative[];
  files?: SnapshotFile[];
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

  const messageRows = (meta.messages ?? []) as SnapshotMessage[];
  const messageById = new Map(messageRows.map((m) => [m.id, m]));
  const matrixItemsIn = (meta.matrixItems ?? []) as SnapshotMatrixItem[];
  // Resolve referenced messages so the client only receives the rows it needs.
  const matrixItems = matrixItemsIn
    .map((p) => {
      const m = messageById.get(p.messageId);
      if (!m) return null;
      return { messageId: p.messageId, size: p.size, message: m };
    })
    .filter((x): x is { messageId: number; size: string; message: SnapshotMessage } => x !== null);
  const creativeRows = (meta.creatives ?? []) as SnapshotCreative[];
  const fileRows = (meta.files ?? []) as SnapshotFile[];

  const laf = getLookAndFeelByClientId(client.id);
  const style = lookAndFeelToCssVars(laf) as CSSProperties;

  const generated = meta.generatedAt
    ? new Date(meta.generatedAt).toISOString().slice(0, 10)
    : null;

  return (
    <div className="share-gallery min-h-screen bg-slate-50" style={style}>
      <ShareGallery
        shareId={share.id}
        clientName={client.name}
        shareTitle={share.title}
        shareDescription={share.description}
        generatedAt={generated}
        matrixItems={matrixItems}
        creatives={creativeRows}
        files={fileRows}
      />
      <footer className="share-gallery__footer mx-auto max-w-6xl px-6 py-4 text-center text-[11px] text-slate-400">
        Shared from {client.name} · MessagingMatrix
      </footer>
    </div>
  );
}
