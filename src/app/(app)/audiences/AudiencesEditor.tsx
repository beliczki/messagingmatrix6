"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DimensionGrid from "../_components/DimensionGrid/DimensionGrid";
import { AUDIENCE_COLUMNS } from "../_components/DimensionGrid/columns";
import { useKeywordOptions } from "../_components/useKeywordOptions";
import { type Audience } from "../matrix/types";
import { emptySearchFields, type SearchFields } from "@/lib/search-query";

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function audienceToSearchFields(a: Audience): SearchFields {
  const fields = emptySearchFields();
  fields.audience = `${a.key} ${a.name ?? ""}`.toLowerCase();
  fields.strategy = (a.strategy ?? "").toLowerCase();
  fields.platform = (a.buyingPlatform ?? "").toLowerCase();
  fields.free = [
    a.key,
    a.name,
    a.product,
    a.status,
    a.strategy,
    a.buyingPlatform,
    a.dataSource,
    a.targetingType,
    a.device,
    a.tag,
    a.comment,
    a.campaignName,
    a.campaignId,
    a.lineitemName,
    a.lineitemId,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return fields;
}

export default function AudiencesEditor() {
  const [showArchived, setShowArchived] = useState(false);
  const { options: keywordOptions } = useKeywordOptions();

  const liveQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () => fetchJSON<{ audiences: Audience[] }>("/api/audiences"),
  });
  const archivedQ = useQuery({
    queryKey: ["audiences", "with-archived"],
    queryFn: () =>
      fetchJSON<{ audiences: Audience[] }>(
        "/api/audiences?includeArchived=1",
      ),
    enabled: showArchived,
  });

  const liveRows = liveQ.data?.audiences ?? [];
  const allRows = archivedQ.data?.audiences ?? liveRows;
  const rows = showArchived ? allRows : liveRows;

  const archivedCount = useMemo(() => {
    if (!archivedQ.data) return 0;
    return archivedQ.data.audiences.filter((a) => a.archivedAt !== null).length;
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
        Loading audiences…
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
    <DimensionGrid<Audience>
      title="Audiences"
      rows={rows}
      columns={AUDIENCE_COLUMNS}
      baseUrl="/api/audiences"
      queryKey={["audiences"]}
      toSearchFields={audienceToSearchFields}
      productOptions={productOptions}
      statusOptions={statusOptions}
      keywordOptions={keywordOptions}
      getProduct={(r) => r.product}
      getStatus={(r) => r.status}
      showArchived={showArchived}
      onShowArchivedChange={setShowArchived}
      archivedCount={archivedCount}
      isArchived={(r) => r.archivedAt !== null}
      visibilityStorageKey="mm6_audiences_grid_cols"
      rightToolbarStorageKey="mm6_audiences_right_toolbar_open"
      storageKeyPrefix="mm6_audiences"
      historyEntity="audiences"
      getHistoryLabel={(r) => r.name ?? r.key}
    />
  );
}
