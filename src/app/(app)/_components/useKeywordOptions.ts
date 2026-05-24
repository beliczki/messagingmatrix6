"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Keyword } from "@/db/schema";
import type { KeywordOptions } from "./DimensionGrid/DimensionGrid";

type KeywordsResponse = { keywords: Keyword[] };

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// Single-source react-query for the Settings → Keywords list. Returns the
// grouped `{form: {field: values[]}}` shape DimensionGrid expects, derived
// from the active (non-archived) rows in their stored orderIndex.
// The query key is shared with the Settings UI so SSE invalidation refreshes
// the audience/topic editor live when an admin edits the list.
export function useKeywordOptions(): {
  options: KeywordOptions;
  isLoading: boolean;
  error: unknown;
} {
  const q = useQuery<KeywordsResponse>({
    queryKey: ["keywords"],
    queryFn: () => fetchJSON<KeywordsResponse>("/api/keywords"),
    staleTime: 60_000,
  });
  const options = useMemo<KeywordOptions>(() => {
    const out: KeywordOptions = {};
    for (const k of q.data?.keywords ?? []) {
      if (k.archivedAt) continue;
      (out[k.form] ??= {})[k.field] ??= [];
      out[k.form][k.field].push(k.value);
    }
    return out;
  }, [q.data]);
  return { options, isLoading: q.isLoading, error: q.error };
}
