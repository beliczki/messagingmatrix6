"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  Search,
  X,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import UploadDialog, { type UploadResult } from "../_components/UploadDialog";
import UploadQueue, {
  useDropTarget,
  type QueueItem,
} from "../_components/UploadQueue";
import MultiPill from "../_components/MultiPill";
import ArchiveToggle from "../_components/ArchiveToggle";
import RightToolbar from "../_components/RightToolbar";
import CreativeDetailDialog from "./CreativeDetailDialog";
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
import type { ParseRules } from "@/lib/parse-filename";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type Creative = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  template: string | null;
  bannerVersion: string | null;
  visualKeyword: string | null;
  copyKeyword: string | null;
  mcNumber: number | null;
  mcVariant: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileSize: string | null;
  fileDimensions: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
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

export default function CreativeLibrary() {
  const [search, setSearch] = usePersistent(
    "mm6_creative_library_filter_search",
    "",
    STRING_CODEC,
  );
  const [products, setProducts] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_products",
    new Set(),
    SET_CODEC,
  );
  const [types, setTypes] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_types",
    new Set(),
    SET_CODEC,
  );
  const [sizes, setSizes] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_sizes",
    new Set(),
    SET_CODEC,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [view, setView] = usePersistent<LibraryViewMode>(
    "mm6_creative_library_view",
    "masonry",
    LIBRARY_VIEW_CODEC,
  );

  const debouncedSearch = useDebouncedValue(search, 200);
  const [visibleCount, setVisibleCount] = useState(200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const creativesQ = useQuery({
    queryKey: ["creatives", { showArchived }],
    queryFn: () =>
      fetchJSON<{ creatives: Creative[] }>(
        showArchived ? "/api/creatives?includeArchived=1" : "/api/creatives",
      ),
  });
  const filesQ = useQuery({
    queryKey: ["files", "creative"],
    queryFn: () =>
      fetchJSON<{ files: UploadedFile[] }>("/api/files?category=creative"),
  });
  const rulesQ = useQuery({
    queryKey: ["parsingRules"],
    queryFn: () => fetchJSON<{ rules: ParseRules }>("/api/config/parsing-rules"),
  });
  const parsingRules = rulesQ.data?.rules ?? {};

  const qcCommit = useQueryClient();
  const queue = UploadQueue({
    category: "creative",
    parsingRules,
    renderForm: ({ item, update }) => (
      <QueueItemForm item={item} update={update} />
    ),
    commitItem: async (item: QueueItem) => {
      if (!item.uploadedFileId) throw new Error("file not uploaded");
      const r = await fetch("/api/creatives", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: item.metadata.brand || null,
          product: item.metadata.product || null,
          type: item.metadata.type || null,
          template: item.metadata.template || null,
          visualKeyword: item.metadata.visualKeyword || null,
          mcNumber: item.metadata.mcNumber
            ? Number(item.metadata.mcNumber)
            : null,
          mcVariant: item.metadata.mcVariant || null,
          comment: item.metadata.comment || null,
          fileId: item.uploadedFileId,
          fileName: item.uploadedFilename,
          fileSize: item.uploadedSize ? String(item.uploadedSize) : null,
          fileDimensions: item.uploadedDimensions,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onAllDone: () => {
      qcCommit.invalidateQueries({ queryKey: ["creatives"] });
      qcCommit.invalidateQueries({ queryKey: ["files", "creative"] });
    },
  });
  const drop = useDropTarget(queue.addFiles);

  const creatives = creativesQ.data?.creatives ?? [];
  const files = filesQ.data?.files ?? [];
  const filesById = useMemo(
    () => new Map(files.map((f) => [f.id, f])),
    [files],
  );

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of creatives) if (c.product) s.add(c.product);
    return [...s].sort();
  }, [creatives]);
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of creatives) if (c.type) s.add(c.type);
    return [...s].sort();
  }, [creatives]);
  const sizeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of creatives) if (c.fileDimensions) s.add(c.fileDimensions);
    return [...s].sort((a, b) => {
      const [aw = 0] = a.split("x").map(Number);
      const [bw = 0] = b.split("x").map(Number);
      return aw - bw || a.localeCompare(b);
    });
  }, [creatives]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    return creatives.filter((c) => {
      if (products.size > 0 && (!c.product || !products.has(c.product))) {
        return false;
      }
      if (types.size > 0 && (!c.type || !types.has(c.type))) {
        return false;
      }
      if (sizes.size > 0 && (!c.fileDimensions || !sizes.has(c.fileDimensions))) {
        return false;
      }
      if (term) {
        const haystack =
          `${c.fileName ?? ""} ${c.brand ?? ""} ${c.product ?? ""} ${c.template ?? ""} ${c.visualKeyword ?? ""} ${c.copyKeyword ?? ""}`
            .toLowerCase();
        const mc = c.mcNumber !== null ? `mc${c.mcNumber}${c.mcVariant ?? ""}`.toLowerCase() : "";
        if (!haystack.includes(term) && !mc.includes(term)) return false;
      }
      return true;
    });
  }, [creatives, products, types, sizes, debouncedSearch]);

  useEffect(() => {
    setVisibleCount(200);
  }, [products, types, sizes, debouncedSearch, view]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + 200);
        }
      },
      { root: scrollRef.current, rootMargin: "400px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [filtered.length, visibleCount]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  const qc = useQueryClient();

  return (
    <div className="creative-library flex h-full">
      <div className="creative-library__content flex flex-1 flex-col overflow-hidden">
        <Toolbar
          search={search}
          setSearch={setSearch}
          productOptions={productOptions}
          products={products}
          setProducts={setProducts}
          typeOptions={typeOptions}
          types={types}
          setTypes={setTypes}
          sizeOptions={sizeOptions}
          sizes={sizes}
          setSizes={setSizes}
          total={creatives.length}
          visible={filtered.length}
        />

        <div
          ref={scrollRef}
          className={clsx(
            "creative-library__scroll relative flex-1 overflow-auto p-4 transition",
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
          {creativesQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState empty={creatives.length === 0} onUpload={() => setUploadOpen(true)} />
          ) : (
            <>
              {view === "masonry" ? (
                <div className="creative-library__view creative-library__view--masonry">
                  <Masonry
                    items={visible}
                    render={(c) => (
                      <ImageTile
                        creative={c}
                        file={c.fileId ? filesById.get(c.fileId) : undefined}
                        onOpen={() => setDetailId(c.id)}
                      />
                    )}
                  />
                </div>
              ) : view === "grid" ? (
                <div className="creative-library__view creative-library__view--grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {visible.map((c) => (
                    <Card
                      key={c.id}
                      creative={c}
                      file={c.fileId ? filesById.get(c.fileId) : undefined}
                      onOpen={() => setDetailId(c.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="creative-library__view creative-library__view--list flex flex-col gap-1.5">
                  {visible.map((c) => (
                    <ListRow
                      key={c.id}
                      creative={c}
                      file={c.fileId ? filesById.get(c.fileId) : undefined}
                      onOpen={() => setDetailId(c.id)}
                    />
                  ))}
                </div>
              )}
              {visibleCount < filtered.length ? (
                <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
              ) : null}
            </>
          )}
        </div>

        {queue.panel}

        <UploadDialog
          open={uploadOpen}
          category="creative"
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            qc.invalidateQueries({ queryKey: ["files", "creative"] });
          }}
          metadataForm={({ file, submit, submitting }) => (
            <CreativeMetadataForm file={file} submit={submit} submitting={submitting} />
          )}
        />

        {detailId !== null
          ? (() => {
              const c = filtered.find((x) => x.id === detailId)
                ?? creatives.find((x) => x.id === detailId);
              if (!c) return null;
              return (
                <CreativeDetailDialog
                  creative={c}
                  creatives={filtered}
                  file={c.fileId ? filesById.get(c.fileId) : undefined}
                  onJump={(id) => setDetailId(id)}
                  onClose={() => setDetailId(null)}
                />
              );
            })()
          : null}
      </div>

      <RightToolbar storageKey="mm6_creative_library_right_toolbar_open">
        {(collapsed) => {
          const content = (
            <>
              <LibraryViewSwitcher view={view} setView={setView} collapsed={collapsed}>
                <ArchiveToggle
                  showArchived={showArchived}
                  onChange={setShowArchived}
                  collapsed={collapsed}
                />
              </LibraryViewSwitcher>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                title="Upload"
                aria-label="Upload"
                className={clsx(
                  "toolbar-btn--primary mt-auto inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800",
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

function Toolbar({
  search,
  setSearch,
  productOptions,
  products,
  setProducts,
  typeOptions,
  types,
  setTypes,
  sizeOptions,
  sizes,
  setSizes,
  total,
  visible,
}: {
  search: string;
  setSearch: (s: string) => void;
  productOptions: string[];
  products: Set<string>;
  setProducts: (s: Set<string>) => void;
  typeOptions: string[];
  types: Set<string>;
  setTypes: (s: Set<string>) => void;
  sizeOptions: string[];
  sizes: Set<string>;
  setSizes: (s: Set<string>) => void;
  total: number;
  visible: number;
}) {
  const activeFilters = products.size + types.size + sizes.size + (search ? 1 : 0);
  return (
    <div className="toolbar creative-library__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex items-baseline gap-2">
        <div className="toolbar__title text-sm font-semibold text-slate-900">Creative Library</div>
      </div>

      <div className="input-box input-box--with-icon relative ml-2">
        <Search className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filename, brand, MC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-box__field w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

      <MultiPill label="Product" values={products} options={productOptions} onChange={setProducts} />
      <MultiPill label="Type" values={types} options={typeOptions} onChange={setTypes} />
      <MultiPill label="Size" values={sizes} options={sizeOptions} onChange={setSizes} />

      {activeFilters > 0 ? (
        <button
          onClick={() => {
            setProducts(new Set());
            setTypes(new Set());
            setSizes(new Set());
            setSearch("");
          }}
          className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      <div className="toolbar__count ml-auto text-[11px] text-slate-500">
        {visible}/{total} creatives
      </div>
    </div>
  );
}

function Card({
  creative,
  file,
  onOpen,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const mcLabel =
    creative.mcNumber !== null
      ? `MC${creative.mcNumber}${creative.mcVariant ?? ""}`
      : null;
  const archived = creative.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "creative-card group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 hover:shadow-md [content-visibility:auto] [contain-intrinsic-size:auto_220px]",
        archived && "row--archived",
      )}
    >
      <div className="creative-card__thumb thumb-checker relative aspect-[4/3]">
        {isImage && creative.fileId ? (
          <img
            src={`/api/files/${creative.fileId}/thumbnail?w=240`}
            alt={creative.fileName ?? "creative"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && creative.fileId ? (
          <video
            src={`/api/files/${creative.fileId}#t=0.1`}
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
      <div className="creative-card__meta p-2 text-xs">
        <div className="flex items-baseline gap-2">
          {mcLabel ? (
            <span className="creative-card__mc font-mono font-semibold text-slate-900">{mcLabel}</span>
          ) : null}
          <span className="creative-card__filename row--archived__filename truncate text-slate-700" title={creative.fileName ?? ""}>
            {creative.fileName ?? "(no file)"}
          </span>
        </div>
        <div className="creative-card__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {creative.brand ? <span className="tag-chip">{creative.brand}</span> : null}
          {creative.product ? <span className="tag-chip">· {creative.product}</span> : null}
          {creative.template ? <span className="tag-chip">· {creative.template}</span> : null}
          {creative.fileDimensions ? <span className="tag-chip">· {creative.fileDimensions}</span> : null}
        </div>
      </div>
    </button>
  );
}

function ImageTile({
  creative,
  file,
  onOpen,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const archived = creative.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "media-tile thumb-checker group block w-full overflow-hidden rounded-md [content-visibility:auto] [contain-intrinsic-size:auto_300px]",
        archived && "row--archived",
      )}
    >
      {isImage && creative.fileId ? (
        <img
          src={`/api/files/${creative.fileId}/thumbnail?w=320`}
          alt={creative.fileName ?? "creative"}
          className="media-tile__image block w-full"
          loading="lazy"
          decoding="async"
        />
      ) : isVideo && creative.fileId ? (
        <video
          src={`/api/files/${creative.fileId}#t=0.1`}
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
  creative,
  file,
  onOpen,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const mcLabel =
    creative.mcNumber !== null
      ? `MC${creative.mcNumber}${creative.mcVariant ?? ""}`
      : null;
  const archived = creative.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "creative-row group flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:border-slate-400 hover:shadow-sm [content-visibility:auto] [contain-intrinsic-size:auto_56px]",
        archived && "row--archived",
      )}
    >
      <div className="creative-row__thumb thumb-checker size-12 shrink-0 overflow-hidden rounded">
        {isImage && creative.fileId ? (
          <img
            src={`/api/files/${creative.fileId}/thumbnail?w=96`}
            alt={creative.fileName ?? "creative"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && creative.fileId ? (
          <video
            src={`/api/files/${creative.fileId}#t=0.1`}
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
      <div className="creative-row__meta min-w-0 flex-1 text-xs">
        <div className="flex items-baseline gap-2">
          {mcLabel ? (
            <span className="creative-row__mc font-mono font-semibold text-slate-900">{mcLabel}</span>
          ) : null}
          <span className="creative-row__filename row--archived__filename truncate text-slate-700" title={creative.fileName ?? ""}>
            {creative.fileName ?? "(no file)"}
          </span>
        </div>
        <div className="creative-row__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {creative.brand ? <span className="tag-chip">{creative.brand}</span> : null}
          {creative.product ? <span className="tag-chip">· {creative.product}</span> : null}
          {creative.template ? <span className="tag-chip">· {creative.template}</span> : null}
          {creative.fileDimensions ? <span className="tag-chip">· {creative.fileDimensions}</span> : null}
        </div>
      </div>
    </button>
  );
}

function CreativeMetadataForm({
  file,
  submit,
  submitting,
}: {
  file: UploadResult | null;
  submit: (extra: Record<string, unknown>) => Promise<void>;
  submitting: boolean;
}) {
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [type, setType] = useState("");
  const [template, setTemplate] = useState("");
  const [mcNumber, setMcNumber] = useState("");
  const [mcVariant, setMcVariant] = useState("");
  const [comment, setComment] = useState("");
  const qc = useQueryClient();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const r = await fetch("/api/creatives", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brand || null,
        product: product || null,
        type: type || null,
        template: template || null,
        mcNumber: mcNumber ? Number(mcNumber) : null,
        mcVariant: mcVariant || null,
        comment: comment || null,
        fileId: file.fileId,
        fileName: file.filename,
        fileSize: file.sizeBytes ? String(file.sizeBytes) : null,
        fileDimensions: file.dimensions,
      }),
    });
    if (!r.ok) {
      alert(await r.text());
      return;
    }
    qc.invalidateQueries({ queryKey: ["creatives"] });
    await submit({});
  }

  return (
    <form onSubmit={onSubmit} className="creative-metadata-form space-y-2 text-xs">
      <div className="form-grid grid grid-cols-2 gap-2">
        <Field label="Brand">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Product">
          <input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Type">
          <input value={type} onChange={(e) => setType(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Template">
          <input value={template} onChange={(e) => setTemplate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="MC number">
          <input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} className={inputCls} />
        </Field>
        <Field label="MC variant">
          <input value={mcVariant} onChange={(e) => setMcVariant(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Comment">
        <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
      </Field>
      <button
        type="submit"
        disabled={submitting}
        className={clsx(
          "toolbar-btn--primary mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white",
          submitting && "opacity-50",
        )}
      >
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save creative
      </button>
    </form>
  );
}

const inputCls =
  "input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none";

function QueueItemForm({
  item,
  update,
}: {
  item: QueueItem;
  update: (patch: Partial<QueueItem["metadata"]>) => void;
}) {
  const cellCls =
    "input-box rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs focus:border-slate-500 focus:outline-none";
  const fields: Array<{ k: string; label: string }> = [
    { k: "brand", label: "Brand" },
    { k: "product", label: "Product" },
    { k: "type", label: "Type" },
    { k: "mcNumber", label: "MC#" },
    { k: "mcVariant", label: "Variant" },
  ];
  return (
    <div className="upload-queue__item-form form-grid grid grid-cols-5 gap-1.5">
      {fields.map((f) => (
        <label key={f.k} className="form-field block">
          <div className="form-field__label mb-0.5 text-[9px] uppercase tracking-wide text-slate-500">
            {f.label}
          </div>
          <input
            value={item.metadata[f.k] ?? ""}
            onChange={(e) => update({ [f.k]: e.target.value })}
            className={cellCls}
          />
        </label>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field block">
      <div className="form-field__label mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </label>
  );
}

function EmptyState({
  empty,
  onUpload,
}: {
  empty: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="empty-state creative-library__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <ImageIcon className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
        <h2 className="empty-state__title text-sm font-semibold text-slate-900">
          {empty ? "No creatives yet" : "No creatives match the filters"}
        </h2>
        <p className="empty-state__hint mt-1 text-xs text-slate-500">
          {empty
            ? "Upload an HTML banner, a static image, or a video clip."
            : "Clear filters or adjust the search to see all creatives."}
        </p>
        {empty ? (
          <button
            onClick={onUpload}
            className="toolbar-btn--primary mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <UploadIcon className="size-3.5" />
            Upload first creative
          </button>
        ) : null}
      </div>
    </div>
  );
}

