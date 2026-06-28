import { NextResponse } from "next/server";
import { listVisibleTemplates } from "@/lib/templates";
import { withSession } from "@/lib/scoped";

export const GET = withSession(async ({ claims }) => {
  return NextResponse.json({
    templates: await listVisibleTemplates(claims.cid),
  });
});
