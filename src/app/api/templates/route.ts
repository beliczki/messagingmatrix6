import { NextResponse } from "next/server";
import { listVisibleTemplates } from "@/lib/templates";
import { withSession } from "@/lib/scoped";

export const GET = withSession(({ claims }) => {
  return NextResponse.json({
    templates: listVisibleTemplates(claims.cid),
  });
});
