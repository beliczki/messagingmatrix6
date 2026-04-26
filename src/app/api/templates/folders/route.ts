import { NextResponse } from "next/server";
import { listAllTemplates } from "@/lib/templates";
import { withAdmin } from "@/lib/scoped";

// Admin: every template on disk regardless of per-client visibility.
// Used by Settings → Design tab to toggle visibility per client.
export const GET = withAdmin(() => {
  return NextResponse.json({ templates: listAllTemplates() });
});
