import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { renderTemplate } from "@/lib/render";
import { listTextFormatting } from "@/lib/entities/text-formatting";

export const POST = withSession(async ({ req, claims }) => {
  const body = await req.json().catch(() => null);
  const templateName = typeof body?.templateName === "string" ? body.templateName : null;
  const size = typeof body?.size === "string" ? body.size : null;
  const message = body?.message;
  if (!templateName || !size || typeof message !== "object" || message === null) {
    return NextResponse.json(
      { error: "missing_params", required: ["templateName", "size", "message"] },
      { status: 400 },
    );
  }

  // Pull the active client's text_formatting unless the caller passed an
  // explicit override (used by share-gallery rendering with a frozen ruleset).
  const textFormatting = Array.isArray(body?.textFormatting)
    ? body.textFormatting
    : await listTextFormatting(claims.cid);

  const inline = body?.inline === true;
  const skipAnimations = body?.skipAnimations === true;

  try {
    const { html } = renderTemplate({
      templateName,
      size,
      message: message as Record<string, unknown>,
      textFormatting,
      inline,
      skipAnimations,
    });
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
});
