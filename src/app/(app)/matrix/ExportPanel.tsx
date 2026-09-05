"use client";

import { useEffect, useState } from "react";
import { Rss, Table2 } from "lucide-react";
import ToggleBtn from "../_components/ToggleBtn";
import MatrixExportPanel from "./MatrixExportPanel";
import FeedExportPanel from "./FeedExportPanel";
import type { Audience, Filters, Message, Topic } from "./types";

type ExportMode = "matrix" | "feed";

const STORAGE_KEY = "mm6_matrix_export_mode";

// The matrix has two exports and they are not variants of one thing: the matrix
// XLSX is a snapshot of the board scoped by the page filters, the feed XLSX is a
// versioned AdForm artefact with its own gate, baseline and DEFAULT row. One box,
// one switch, and each branch brings its own setup — including the feed branch's
// "you are not filtered narrowly enough to export" warning.
export default function ExportPanel({
  filters,
  filteredMessages,
  audiences,
  topics,
}: {
  filters: Filters;
  filteredMessages: Message[];
  audiences: Audience[];
  topics: Topic[];
}) {
  const [mode, setMode] = useState<ExportMode>("matrix");

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "matrix" || v === "feed") setMode(v);
    } catch {}
  }, []);

  function choose(next: ExportMode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  return (
    <div className="export-panel rounded-md border border-slate-200 bg-white p-3">
      <div className="export-panel__title text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Export
      </div>

      <div className="toggle-group export-panel__switch mt-2 flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
        <ToggleBtn active={mode === "matrix"} onClick={() => choose("matrix")}>
          <Table2 className="size-3.5" />
          Matrix
        </ToggleBtn>
        <ToggleBtn active={mode === "feed"} onClick={() => choose("feed")}>
          <Rss className="size-3.5" />
          Feed
        </ToggleBtn>
      </div>

      <div className="export-panel__body mt-3">
        {mode === "matrix" ? (
          <MatrixExportPanel filters={filters} />
        ) : (
          <FeedExportPanel
            filters={filters}
            filteredMessages={filteredMessages}
            audiences={audiences}
            topics={topics}
          />
        )}
      </div>
    </div>
  );
}
