import { NextResponse } from "next/server";
import { withSession } from "@/lib/scoped";
import { collectStalePreviews } from "@/lib/previews";
import { mcLabelFor } from "@/lib/mc-label";

// Feeds the creative-library "missing previews" warning: which html MCs have
// at least one absent-or-stale size preview, and which sizes.
export const GET = withSession(async ({ claims }) => {
  const { stale, fresh } = await collectStalePreviews(claims.cid);

  const byMessage = new Map<number, { mcLabel: string; sizes: string[] }>();
  for (const item of stale) {
    const entry = byMessage.get(item.message.id) ?? {
      mcLabel: mcLabelFor(item.message),
      sizes: [],
    };
    entry.sizes.push(item.size);
    byMessage.set(item.message.id, entry);
  }
  const offenders = [...byMessage.values()].sort((a, b) =>
    a.mcLabel.localeCompare(b.mcLabel),
  );

  return NextResponse.json({
    staleCount: stale.length,
    freshCount: fresh,
    mcCount: offenders.length,
    offenders,
  });
});
