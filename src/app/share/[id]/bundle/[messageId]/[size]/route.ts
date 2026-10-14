import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, messages, shareGalleries } from "@/db/schema";
import { listTextFormatting } from "@/lib/entities/text-formatting";
import {
  BundleTemplateError,
  bundleProduct,
  cleanBundle,
  packageZipName,
  renderBundle,
  zipBundle,
} from "@/lib/html5-bundle";

// A shared DCO cell as an ad-server-ready HTML5 zip — the same bundle
// cleanup:bundle writes. Public like the rest of the viewer, so gated the same
// way: the (message, size) pair must be an item of this live share, and the
// content is the share's frozen message row.

type Params = { id: string; messageId: string; size: string };
type Snapshot = {
  messages?: Array<typeof messages.$inferSelect>;
  matrixItems?: Array<{ messageId: number; size: string }>;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<Params> },
): Promise<NextResponse> {
  const { id, messageId: rawId, size } = await ctx.params;
  const messageId = Number(rawId);
  const [share] = await db.select().from(shareGalleries).where(eq(shareGalleries.id, id)).limit(1);
  if (!share || share.archivedAt !== null || !share.metadata) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const snapshot = JSON.parse(share.metadata) as Snapshot;
  const isItem = (snapshot.matrixItems ?? []).some(
    (p) => p.messageId === messageId && p.size === size,
  );
  const message = (snapshot.messages ?? []).find((m) => m.id === messageId);
  if (!isItem || !message) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!message.topic) {
    return NextResponse.json({ error: "MC has no topic to name the bundle by" }, { status: 422 });
  }

  const [client] = await db
    .select({ key: clients.key })
    .from(clients)
    .where(eq(clients.id, share.clientId))
    .limit(1);
  const textFormatting = (await listTextFormatting(share.clientId)).filter(
    (r) => r.archivedAt === null,
  );

  let zip: Buffer;
  try {
    const rendered = await renderBundle({ clientId: share.clientId, message, size, textFormatting });
    zip = await zipBundle(
      cleanBundle(rendered, size, { variant: message.variant, title: message.topic }),
    );
  } catch (e) {
    // A template the bundle transform does not know is an answer, not a crash:
    // the viewer falls back to the single-file HTML download for it.
    if (e instanceof BundleTemplateError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }

  const name = packageZipName({
    brand: client!.key.toUpperCase(),
    product: bundleProduct(message.topic, message.draftProduct),
    number: message.number,
    variant: message.variant,
    topic: message.topic,
    n: message.versionNo,
    size,
  });
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
