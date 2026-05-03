"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DimensionGrid from "../_components/DimensionGrid/DimensionGrid";
import { TEXT_FORMATTING_COLUMNS } from "../_components/DimensionGrid/columns";
import { type TextFormattingRule } from "../matrix/types";
import { emptySearchFields, type SearchFields } from "@/lib/search-query";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function ruleToSearchFields(t: TextFormattingRule): SearchFields {
  const fields = emptySearchFields();
  fields.free = [
    String(t.id),
    t.textOriginal,
    t.textFormatted,
    t.formattingScope,
    t.formattingMcScope,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return fields;
}

export default function TextsEditor() {
  const [showArchived, setShowArchived] = useState(false);

  const liveQ = useQuery({
    queryKey: ["text_formatting"],
    queryFn: () =>
      fetchJSON<{ text_formatting: TextFormattingRule[] }>(
        "/api/text-formatting",
      ),
  });
  const archivedQ = useQuery({
    queryKey: ["text_formatting", "with-archived"],
    queryFn: () =>
      fetchJSON<{ text_formatting: TextFormattingRule[] }>(
        "/api/text-formatting?includeArchived=1",
      ),
    enabled: showArchived,
  });

  const liveRows = liveQ.data?.text_formatting ?? [];
  const allRows = archivedQ.data?.text_formatting ?? liveRows;
  const rows = showArchived ? allRows : liveRows;

  const archivedCount = useMemo(() => {
    if (!archivedQ.data) return 0;
    return archivedQ.data.text_formatting.filter((t) => t.archivedAt !== null)
      .length;
  }, [archivedQ.data]);

  if (liveQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading texts…
      </div>
    );
  }
  if (liveQ.error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-rose-600">
        {(liveQ.error as Error).message}
      </div>
    );
  }

  return (
    <DimensionGrid<TextFormattingRule>
      title="Texts"
      rows={rows}
      columns={TEXT_FORMATTING_COLUMNS}
      baseUrl="/api/text-formatting"
      queryKey={["text_formatting"]}
      toSearchFields={ruleToSearchFields}
      productOptions={[]}
      statusOptions={[]}
      getProduct={() => null}
      getStatus={() => null}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      archivedCount={archivedCount}
      isArchived={(r) => r.archivedAt !== null}
      visibilityStorageKey="mm6_texts_grid_cols"
      rightToolbarStorageKey="mm6_texts_right_toolbar_open"
    />
  );
}
