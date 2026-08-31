"use client";

import { useQuery } from "@tanstack/react-query";
import type { TextFormatting } from "@/db/schema";

// One query, one shape, one place.
//
// MessageEditor and FeedView both need the text-formatting rules and both used
// the key ["text-formatting"], but they cached different things under it: the
// editor stored the API envelope ({ text_formatting: [...] }), FeedView the
// unwrapped array. Whichever mounted first won the cache entry, so opening an
// MC in the matrix and then switching to Feed view handed FeedView an object
// where it expected an array — `rules.filter is not a function` inside
// buildSizeSpans, thrown during render, which took the whole matrix route to
// its error boundary. Reloading "fixed" it only because FeedView then
// repopulated the key first.
//
// Sharing a query key is sharing a contract. Keeping the fetch here is what
// makes that contract impossible to state twice.
export const TEXT_FORMATTING_QUERY_KEY = ["text-formatting"] as const;

export function useTextFormattingRules(enabled = true) {
  return useQuery({
    queryKey: TEXT_FORMATTING_QUERY_KEY,
    queryFn: async (): Promise<TextFormatting[]> => {
      const r = await fetch("/api/text-formatting", { credentials: "include" });
      if (!r.ok) throw new Error("text-formatting");
      const data = (await r.json()) as { text_formatting: TextFormatting[] };
      return data.text_formatting ?? [];
    },
    enabled,
  });
}
