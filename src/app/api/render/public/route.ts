import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, shareGalleries } from "@/db/schema";
import { renderTemplate } from "@/lib/render";
import { listTextFormatting } from "@/lib/entities/text-formatting";

// Public render variant for the share gallery viewer. The viewer is
// unauthenticated, so we cannot use the session-scoped /api/render endpoint.
// Access is gated on the messageId being present in the share's snapshot
// metadata. text_formatting rules use the share's client's current ruleset
// (the snapshot does not freeze them — formatting rules are managed centrally
// and rarely change post-share).

type Body = {
  shareId?: unknown;
  messageId?: unknown;
  size?: unknown;
  templateName?: unknown;
  /** When true, set Content-Disposition: attachment for browser-driven download. */
  download?: unknown;
};

type Snapshot = {
  messages?: Array<typeof messages.$inferSelect>;
};

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const shareId = typeof body?.shareId === "string" ? body.shareId : null;
  const messageId = Number(body?.messageId);
  const size = typeof body?.size === "string" ? body.size : null;
  if (!shareId || !Number.isFinite(messageId) || !size) {
    return bad("missing_params");
  }

  const [share] = await db
    .select()
    .from(shareGalleries)
    .where(eq(shareGalleries.id, shareId))
    .limit(1);
  if (!share || share.archivedAt !== null) return bad("not_found", 404);

  let snapshot: Snapshot = {};
  try {
    snapshot = share.metadata
      ? (JSON.parse(share.metadata) as Snapshot)
      : {};
  } catch {
    return bad("snapshot_corrupt", 500);
  }
  const message = (snapshot.messages ?? []).find((m) => m.id === messageId);
  if (!message) return bad("not_found", 404);

  const templateName =
    typeof body?.templateName === "string" && body.templateName.length > 0
      ? body.templateName
      : message.template;
  if (!templateName) return bad("missing_template");

  const textFormatting = (await listTextFormatting(share.clientId)).filter(
    (r) => r.archivedAt === null,
  );

  let html: string;
  try {
    const url = new URL(req.url);
    const proto =
      req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host =
      req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    const result = renderTemplate({
      templateName,
      size,
      message: message as unknown as Record<string, unknown>,
      textFormatting,
      inline: true,
      skipAnimations: false,
      baseOrigin: `${proto}://${host}`,
    });
    html = result.html;
  } catch (e) {
    return bad((e as Error).message);
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  };
  if (body?.download === true) {
    const filename = `MC${message.number}${message.variant}-${size}.html`;
    headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  }
  return new NextResponse(html, { status: 200, headers });
}
