"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  Filter as FilterIcon,
  X,
  Image as ImageIcon,
  Loader2,
  Package,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import AssetUploadDialog from "./AssetUploadDialog";
import { useDropTarget, type QueueItem } from "../_components/UploadQueue";
import MultiPill, { ALL_NONE_QUICK_SELECT } from "../_components/MultiPill";
import ArchiveToggle from "../_components/ArchiveToggle";
import RightToolbar from "../_components/RightToolbar";
import AssetDetailDialog from "./AssetDetailDialog";
import {
  LibraryViewSwitcher,
  LIBRARY_VIEW_CODEC,
  type LibraryViewMode,
} from "../_components/LibraryViewSwitcher";
import {
  usePersistent,
  STRING_CODEC,
  SET_CODEC,
} from "../_components/usePersistent";
import {
  ListSortHeader,
  LIST_GRID_TEMPLATE,
  LIST_SORT_CODEC,
  DEFAULT_SORT,
  formatListDate,
  sortListRows,
  type SortState,
} from "../_components/ListSortHeader";
import type { ParseRules } from "@/lib/parse-filename";
import { parseSearchQuery } from "@/lib/search-query";

type Asset = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  visualKeyword: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileSize: string | null;
  fileDimensions: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type UploadedFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function AssetsLibrary() {
  const [search, setSearch] = usePersistent(
    "mm6_assets_filter_search",
    "",
    STRING_CODEC,
  );
  const [products, setProducts] = usePersistent<Set<string>>(
    "mm6_assets_filter_products",
    new Set(),
    SET_CODEC,
  );
  const [types, setTypes] = usePersistent<Set<string>>(
    "mm6_assets_filter_types",
    new Set(),
    SET_CODEC,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  // Files a drop handed over, passed to the dialog when it opens. The button
  // opens the same dialog with an empty list (its own dropzone takes over).
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [view, setView] = usePersistent<LibraryViewMode>(
    "mm6_assets_library_view",
    "masonry",
    LIBRARY_VIEW_CODEC,
  );
  const [sort, setSort] = usePersistent<SortState>(
    "mm6_assets_library_sort",
    DEFAULT_SORT,
    LIST_SORT_CODEC,
  );

  const assetsQ = useQuery({
    queryKey: ["assets", { showArchived }],
    queryFn: () =>
      fetchJSON<{ assets: Asset[] }>(
        showArchived ? "/api/assets?includeArchived=1" : "/api/assets",
      ),
  });
  const filesQ = useQuery({
    queryKey: ["files", "asset"],
    queryFn: () =>
      fetchJSON<{ files: UploadedFile[] }>("/api/files?category=asset"),
  });

  const assets = assetsQ.data?.assets ?? [];
  const files = filesQ.data?.files ?? [];
  const filesById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  const rulesQ = useQuery({
    queryKey: ["parsingRules"],
    queryFn: () => fetchJSON<{ rules: ParseRules }>("/api/config/parsing-rules"),
  });
  const parsingRules = rulesQ.data?.rules ?? {};

  const commitAsset = useCallback(async (item: QueueItem) => {
    if (!item.uploadedFileId) throw new Error("file not uploaded");
    const r = await fetch("/api/assets", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: item.metadata.brand || null,
        product: item.metadata.product || null,
        type: item.metadata.type || null,
        visualKeyword: item.metadata.visualKeyword || null,
        comment: item.metadata.comment || null,
        fileId: item.uploadedFileId,
        fileName: item.uploadedFilename,
        fileSize: item.uploadedSize ? String(item.uploadedSize) : null,
        fileDimensions: item.uploadedDimensions,
      }),
    });
    if (!r.ok) throw new Error(await r.text());
  }, []);

  // Dropping files anywhere on the grid opens the batch dialog with them.
  const drop = useDropTarget(
    useCallback((files: File[]) => {
      setDroppedFiles(files);
      setUploadOpen(true);
    }, []),
  );

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of assets) if (a.product) s.add(a.product);
    return [...s].sort();
  }, [assets]);
  // Counted over the whole set: the product filter is this pill's own.
  const productCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of assets) if (a.product) out[a.product] = (out[a.product] ?? 0) + 1;
    return out;
  }, [assets]);
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of assets) if (a.type) s.add(a.type);
    return [...s].sort();
  }, [assets]);

  const predicate = useMemo(() => parseSearchQuery(search), [search]);
  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (products.size > 0 && (!a.product || !products.has(a.product))) return false;
      if (types.size > 0 && (!a.type || !types.has(a.type))) return false;
      const free =
        `${a.fileName ?? ""} ${a.brand ?? ""} ${a.product ?? ""} ${a.type ?? ""} ${a.visualKeyword ?? ""} ${a.comment ?? ""}`.toLowerCase();
      return predicate({
        audience: "",
        topic: "",
        strategy: "",
        platform: "",
        mc: "",
        free,
      });
    });
  }, [assets, products, types, predicate]);

  const sorted = useMemo(() => sortListRows(filtered, sort), [filtered, sort]);

  const qc = useQueryClient();

  return (
    <div className="assets-library flex h-full">
      <div className="assets-library__content flex flex-1 flex-col overflow-hidden">
      <div className="toolbar assets-library__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex items-baseline gap-2">
          <div className="toolbar__title text-sm font-semibold text-slate-900">Assets</div>
        </div>

        <div className="input-box input-box--with-icon relative ml-2">
          <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Filter… filename, brand, keyword OR …"
            title='Free text searches all fields. OR for alternatives. Quote "two words" for phrases.'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
          />
        </div>

        <MultiPill
          label="Product"
          values={products}
          options={productOptions}
          optionCounts={productCounts}
          quickSelect={ALL_NONE_QUICK_SELECT}
          onChange={setProducts}
        />
        <MultiPill label="Type" values={types} options={typeOptions} onChange={setTypes} />

        {(products.size > 0 || types.size > 0 || search) ? (
          <button
            onClick={() => {
              setProducts(new Set());
              setTypes(new Set());
              setSearch("");
            }}
            className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
          >
            <X className="size-3" />
            Clear
          </button>
        ) : null}

        <div className="toolbar__count ml-auto text-[11px] text-slate-500">
          {filtered.length}/{assets.length} assets
        </div>
      </div>

      <div
        className={clsx(
          "assets-library__scroll relative flex-1 overflow-auto transition",
          view === "list" ? "p-0" : "p-4",
          drop.over && "bg-slate-100 ring-2 ring-inset ring-slate-900",
        )}
        {...drop.handlers}
      >
        {drop.over ? (
          <div className="drop-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="drop-overlay__message rounded-xl bg-slate-900/90 px-5 py-3 text-sm font-medium text-white">
              Drop files to queue them
            </div>
          </div>
        ) : null}
        {assetsQ.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="empty-state assets-library__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <Package className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
              <h2 className="empty-state__title text-sm font-semibold text-slate-900">
                {assets.length === 0 ? "No assets yet" : "Nothing matches the filters"}
              </h2>
              <p className="empty-state__hint mt-1 text-xs text-slate-500">
                {assets.length === 0
                  ? "Upload an image or video clip to use across messages."
                  : "Clear filters or adjust the search."}
              </p>
              {assets.length === 0 ? (
                <button
                  onClick={() => {
                    setDroppedFiles([]);
                    setUploadOpen(true);
                  }}
                  className="toolbar-btn--primary mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <UploadIcon className="size-3.5" />
                  Upload first asset
                </button>
              ) : null}
            </div>
          </div>
        ) : view === "masonry" ? (
          <div className="assets-library__view assets-library__view--masonry">
            <Masonry
              items={sorted}
              itemKey={(a) => a.id}
              render={(a) => (
                <ImageTile
                  asset={a}
                  file={a.fileId ? filesById.get(a.fileId) : undefined}
                  onOpen={() => setDetailId(a.id)}
                />
              )}
            />
          </div>
        ) : view === "grid" ? (
          <div className="assets-library__view assets-library__view--grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {sorted.map((a) => (
              <Card
                key={a.id}
                asset={a}
                file={a.fileId ? filesById.get(a.fileId) : undefined}
                onOpen={() => setDetailId(a.id)}
              />
            ))}
          </div>
        ) : (
          <div className="assets-library__view assets-library__view--list flex flex-col">
            <ListSortHeader sort={sort} onChange={setSort} />
            {sorted.map((a) => (
              <ListRow
                key={a.id}
                asset={a}
                file={a.fileId ? filesById.get(a.fileId) : undefined}
                onOpen={() => setDetailId(a.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AssetUploadDialog
        open={uploadOpen}
        initialFiles={droppedFiles}
        parsingRules={parsingRules}
        productOptions={productOptions}
        typeOptions={typeOptions}
        commitItem={commitAsset}
        onAllDone={() => {
          qc.invalidateQueries({ queryKey: ["assets"] });
          qc.invalidateQueries({ queryKey: ["files", "asset"] });
        }}
        onClose={() => {
          setUploadOpen(false);
          setDroppedFiles([]);
        }}
      />

      {detailId !== null
        ? (() => {
            const a = sorted.find((x) => x.id === detailId)
              ?? assets.find((x) => x.id === detailId);
            if (!a) return null;
            return (
              <AssetDetailDialog
                asset={a}
                assets={sorted}
                file={a.fileId ? filesById.get(a.fileId) : undefined}
                onJump={(id) => setDetailId(id)}
                onClose={() => setDetailId(null)}
              />
            );
          })()
        : null}

      </div>

      <RightToolbar storageKey="mm6_assets_right_toolbar_open">
        {(collapsed) => {
          const content = (
            <>
              <LibraryViewSwitcher view={view} setView={setView} collapsed={collapsed} />
              <ArchiveToggle
                showArchived={showArchived}
                onChange={setShowArchived}
                collapsed={collapsed}
                className="mt-auto"
              />
              <button
                type="button"
                onClick={() => {
                  setDroppedFiles([]);
                  setUploadOpen(true);
                }}
                title="Upload"
                aria-label="Upload"
                className={clsx(
                  "toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800",
                  collapsed ? "size-9" : "px-3 py-1.5 text-xs",
                )}
              >
                <UploadIcon className="size-3.5" />
                {!collapsed ? "Upload" : null}
              </button>
            </>
          );
          return collapsed ? content : <div className="flex h-full flex-col gap-3">{content}</div>;
        }}
      </RightToolbar>
    </div>
  );
}

function Card({
  asset,
  file,
  onOpen,
}: {
  asset: Asset;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const archived = asset.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "asset-card group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 hover:shadow-md [content-visibility:auto] [contain-intrinsic-size:auto_220px]",
        archived && "row--archived",
      )}
    >
      <div className="asset-card__thumb thumb-checker relative aspect-[4/3]">
        {isImage && asset.fileId ? (
          <img
            src={`/api/files/${asset.fileId}/thumbnail?w=400`}
            alt={asset.fileName ?? "asset"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && asset.fileId ? (
          <video
            src={`/api/files/${asset.fileId}#t=0.1`}
            className="size-full object-contain"
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-slate-50 text-slate-300">
            <ImageIcon className="size-8" />
          </div>
        )}
      </div>
      <div className="asset-card__meta p-2 text-xs">
        <div
          className="asset-card__filename row--archived__filename truncate text-slate-700"
          title={asset.fileName ?? ""}
        >
          {asset.fileName ?? "(no file)"}
        </div>
        <div className="asset-card__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {asset.brand ? <span className="tag-chip">{asset.brand}</span> : null}
          {asset.product ? <span className="tag-chip">· {asset.product}</span> : null}
          {asset.type ? <span className="tag-chip">· {asset.type}</span> : null}
          {asset.fileDimensions ? <span className="tag-chip">· {asset.fileDimensions}</span> : null}
        </div>
      </div>
    </button>
  );
}

function ImageTile({
  asset,
  file,
  onOpen,
}: {
  asset: Asset;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const archived = asset.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "media-tile thumb-checker group block w-full overflow-hidden rounded-md [content-visibility:auto] [contain-intrinsic-size:auto_300px]",
        archived && "row--archived",
      )}
    >
      {isImage && asset.fileId ? (
        <img
          src={`/api/files/${asset.fileId}/thumbnail?w=320`}
          alt={asset.fileName ?? "asset"}
          className="media-tile__image block w-full"
          loading="lazy"
          decoding="async"
        />
      ) : isVideo && asset.fileId ? (
        <video
          src={`/api/files/${asset.fileId}#t=0.1`}
          className="media-tile__image block w-full"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <div className="media-tile__placeholder flex aspect-[4/3] items-center justify-center bg-slate-50 text-slate-300">
          <ImageIcon className="size-8" />
        </div>
      )}
    </button>
  );
}

function ListRow({
  asset,
  file,
  onOpen,
}: {
  asset: Asset;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const archived = asset.archivedAt !== null;
  const createdTitle = asset.createdAt ? new Date(asset.createdAt).toLocaleString() : "";
  const updatedTitle = asset.updatedAt ? new Date(asset.updatedAt).toLocaleString() : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "asset-row group grid w-full items-center border-b border-slate-100 bg-white text-left text-xs transition hover:bg-slate-50 [content-visibility:auto] [contain-intrinsic-size:auto_52px]",
        archived && "row--archived",
      )}
      style={{ gridTemplateColumns: LIST_GRID_TEMPLATE }}
    >
      <div className="asset-row__thumb thumb-checker my-1 ml-2 mr-0 size-10 shrink-0 overflow-hidden rounded border border-slate-200">
        {isImage && asset.fileId ? (
          <img
            src={`/api/files/${asset.fileId}/thumbnail?w=96`}
            alt={asset.fileName ?? "asset"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && asset.fileId ? (
          <video
            src={`/api/files/${asset.fileId}#t=0.1`}
            className="size-full object-contain"
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-slate-50 text-slate-300">
            <ImageIcon className="size-5" />
          </div>
        )}
      </div>
      <div className="asset-row__mc truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-400">
        —
      </div>
      <div className="asset-row__name min-w-0 border-r border-slate-100 px-3 py-2">
        <span
          className="asset-row__filename row--archived__filename block truncate text-slate-700"
          title={asset.fileName ?? ""}
        >
          {asset.fileName ?? "(no file)"}
        </span>
      </div>
      <div
        className="asset-row__product truncate border-r border-slate-100 px-3 py-2 text-slate-600"
        title={asset.product ?? ""}
      >
        {asset.product ?? "—"}
      </div>
      <div className="asset-row__type truncate border-r border-slate-100 px-3 py-2 text-slate-600">
        {asset.type ?? "—"}
      </div>
      <div className="asset-row__size truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">
        {asset.fileDimensions ?? "—"}
      </div>
      <div
        className="asset-row__created truncate border-r border-slate-100 px-3 py-2 text-slate-500"
        title={createdTitle}
      >
        {formatListDate(asset.createdAt)}
      </div>
      <div
        className="asset-row__updated truncate px-3 py-2 text-slate-500"
        title={updatedTitle}
      >
        {formatListDate(asset.updatedAt)}
      </div>
    </button>
  );
}
