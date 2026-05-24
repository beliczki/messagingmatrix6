"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DimensionGrid from "../_components/DimensionGrid/DimensionGrid";
import { TOPIC_COLUMNS } from "../_components/DimensionGrid/columns";
import { useKeywordOptions } from "../_components/useKeywordOptions";
import { type Topic } from "../matrix/types";
import { emptySearchFields, type SearchFields } from "@/lib/search-query";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function topicToSearchFields(t: Topic): SearchFields {
  const fields = emptySearchFields();
  fields.topic = `${t.key} ${t.name ?? ""}`.toLowerCase();
  fields.free = [
    t.key,
    t.name,
    t.product,
    t.status,
    t.tag,
    t.tag1,
    t.tag2,
    t.tag3,
    t.tag4,
    t.comment,
    t.created,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return fields;
}

export default function TopicsEditor() {
  const [showArchived, setShowArchived] = useState(false);
  const { options: keywordOptions } = useKeywordOptions();

  const liveQ = useQuery({
    queryKey: ["topics"],
    queryFn: () => fetchJSON<{ topics: Topic[] }>("/api/topics"),
  });
  const archivedQ = useQuery({
    queryKey: ["topics", "with-archived"],
    queryFn: () =>
      fetchJSON<{ topics: Topic[] }>("/api/topics?includeArchived=1"),
    enabled: showArchived,
  });

  const liveRows = liveQ.data?.topics ?? [];
  const allRows = archivedQ.data?.topics ?? liveRows;
  const rows = showArchived ? allRows : liveRows;

  const archivedCount = useMemo(() => {
    if (!archivedQ.data) return 0;
    return archivedQ.data.topics.filter((t) => t.archivedAt !== null).length;
  }, [archivedQ.data]);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of liveRows) if (r.product) s.add(r.product);
    return [...s].sort();
  }, [liveRows]);

  const statusOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of liveRows) if (r.status) s.add(r.status);
    return [...s].sort();
  }, [liveRows]);

  if (liveQ.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading topics…
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
    <DimensionGrid<Topic>
      title="Topics"
      rows={rows}
      columns={TOPIC_COLUMNS}
      baseUrl="/api/topics"
      queryKey={["topics"]}
      toSearchFields={topicToSearchFields}
      productOptions={productOptions}
      statusOptions={statusOptions}
      keywordOptions={keywordOptions}
      getProduct={(r) => r.product}
      getStatus={(r) => r.status}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      archivedCount={archivedCount}
      isArchived={(r) => r.archivedAt !== null}
      visibilityStorageKey="mm6_topics_grid_cols"
      rightToolbarStorageKey="mm6_topics_right_toolbar_open"
      storageKeyPrefix="mm6_topics"
      historyEntity="topics"
      getHistoryLabel={(r) => r.name ?? r.key}
    />
  );
}
