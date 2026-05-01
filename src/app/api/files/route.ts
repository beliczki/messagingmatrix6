import { NextResponse } from "next/server";
import { listFiles } from "@/lib/entities/files";
import { withSession } from "@/lib/scoped";
import type { StorageCategory } from "@/lib/storage";

const VALID_CATS = new Set<StorageCategory>([
  "asset",
  "creative",
  "template-file",
  "share-file",
]);

export const GET = withSession(({ req, claims }) => {
  const url = new URL(req.url);
  const cat = url.searchParams.get("category");
  const q = url.searchParams.get("q") ?? undefined;
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  const category =
    cat && VALID_CATS.has(cat as StorageCategory)
      ? (cat as StorageCategory)
      : undefined;
  return NextResponse.json({
    files: listFiles(claims.cid, { category, q, includeArchived }),
  });
});
