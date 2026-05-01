"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  Search,
  X,
  Archive as ArchiveIcon,
  ArchiveRestore,
  Image as ImageIcon,
  Loader2,
  Package,
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
import type { ParseRules } from "@/lib/parse-filename";

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
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

  const queue = UploadQueue({
    category: "asset",
    parsingRules,
    renderForm: ({ item, update }) => (
      <QueueItemForm item={item} update={update} />
    ),
    commitItem: async (item: QueueItem) => {
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
    },
    onAllDone: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      qc.invalidateQueries({ queryKey: ["files", "asset"] });
    },
  });
  const drop = useDropTarget(queue.addFiles);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of assets) if (a.product) s.add(a.product);
    return [...s].sort();
  }, [assets]);
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of assets) if (a.type) s.add(a.type);
    return [...s].sort();
  }, [assets]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (products.size > 0 && (!a.product || !products.has(a.product))) return false;
      if (types.size > 0 && (!a.type || !types.has(a.type))) return false;
      if (term) {
        const haystack =
          `${a.fileName ?? ""} ${a.brand ?? ""} ${a.product ?? ""} ${a.visualKeyword ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [assets, products, types, search]);

  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (a: Asset) => {
      const r = await fetch(`/api/assets/${a.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "If-Match": String(a.version) },
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });
  const restore = useMutation({
    mutationFn: async (a: Asset) => {
      const r = await fetch(`/api/assets/${a.id}/restore`, {
        method: "POST",
        credentials: "include",
        headers: {
          "If-Match": String(a.version),
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <div className="assets-library flex h-full">
      <div className="assets-library__content flex flex-1 flex-col overflow-hidden">
      <div className="toolbar assets-library__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex items-baseline gap-2">
          <div className="toolbar__title text-sm font-semibold text-slate-900">Assets</div>
          <div className="toolbar__count text-xs text-slate-500">
            {filtered.length}/{assets.length} assets
          </div>
        </div>

        <div className="input-box input-box--with-icon relative ml-2">
          <Search className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder="Filename, brand, keyword…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-box__field w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
          />
        </div>

        <MultiPill label="Product" values={products} options={productOptions} onChange={setProducts} />
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

        <ArchiveToggle
          showArchived={showArchived}
          onChange={setShowArchived}
        />

        <button
          onClick={() => setUploadOpen(true)}
          className="toolbar-btn--primary ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
        >
          <UploadIcon className="size-3.5" />
          Upload
        </button>
      </div>

      <div
        className={clsx(
          "assets-library__scroll relative flex-1 overflow-auto p-4 transition",
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
                  onClick={() => setUploadOpen(true)}
                  className="toolbar-btn--primary mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <UploadIcon className="size-3.5" />
                  Upload first asset
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <Masonry
            items={filtered}
            render={(a) => (
              <Card
                asset={a}
                file={a.fileId ? filesById.get(a.fileId) : undefined}
                onDelete={() => del.mutate(a)}
                onRestore={() => restore.mutate(a)}
              />
            )}
          />
        )}
      </div>

      <UploadDialog
        open={uploadOpen}
        category="asset"
        onClose={() => setUploadOpen(false)}
        onUploaded={() => qc.invalidateQueries({ queryKey: ["files", "asset"] })}
        metadataForm={({ file, submit, submitting }) => (
          <AssetMetadataForm file={file} submit={submit} submitting={submitting} />
        )}
      />

      {queue.panel}
      </div>

      <RightToolbar storageKey="mm6_assets_right_toolbar_open" />
    </div>
  );
}

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
    { k: "visualKeyword", label: "Keyword" },
  ];
  return (
    <div className="upload-queue__item-form form-grid grid grid-cols-4 gap-1.5">
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

function Card({
  asset,
  file,
  onDelete,
  onRestore,
}: {
  asset: Asset;
  file: UploadedFile | undefined;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const archived = asset.archivedAt !== null;
  return (
    <div
      className={clsx(
        "media-tile group overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-slate-400 hover:shadow-md",
        archived && "row--archived",
      )}
    >
      <div className="media-tile__thumb relative aspect-[4/3] bg-slate-50">
        {isImage && asset.fileId ? (
          <img
            src={`/api/files/${asset.fileId}/thumbnail?w=400`}
            alt={asset.fileName ?? "asset"}
            className="media-tile__image size-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="media-tile__placeholder flex size-full items-center justify-center text-slate-300">
            <ImageIcon className="size-8" />
          </div>
        )}
        {archived ? (
          <button
            onClick={onRestore}
            aria-label="Restore"
            title="Restore from archive"
            className="media-tile__restore-btn absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-emerald-600 shadow transition hover:bg-emerald-50"
          >
            <ArchiveRestore className="size-3.5" />
          </button>
        ) : (
          <button
            onClick={onDelete}
            aria-label="Archive"
            title="Archive"
            className="media-tile__archive-btn absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-rose-600 opacity-0 shadow transition group-hover:opacity-100 hover:bg-rose-50"
          >
            <ArchiveIcon className="size-3.5" />
          </button>
        )}
      </div>
      <div className="media-tile__meta p-2 text-xs">
        <div
          className="media-tile__filename row--archived__filename truncate text-slate-700"
          title={asset.fileName ?? ""}
        >
          {asset.fileName ?? "(no file)"}
        </div>
        <div className="media-tile__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {asset.brand ? <span className="tag-chip">{asset.brand}</span> : null}
          {asset.product ? <span className="tag-chip">· {asset.product}</span> : null}
          {asset.type ? <span className="tag-chip">· {asset.type}</span> : null}
          {asset.fileDimensions ? <span className="tag-chip">· {asset.fileDimensions}</span> : null}
        </div>
      </div>
    </div>
  );
}

function AssetMetadataForm({
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
  const [visualKeyword, setVisualKeyword] = useState("");
  const [comment, setComment] = useState("");
  const qc = useQueryClient();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const r = await fetch("/api/assets", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brand || null,
        product: product || null,
        type: type || null,
        visualKeyword: visualKeyword || null,
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
    qc.invalidateQueries({ queryKey: ["assets"] });
    await submit({});
  }

  const inputCls =
    "input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none";
  return (
    <form onSubmit={onSubmit} className="asset-metadata-form space-y-2 text-xs">
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
        <Field label="Visual keyword">
          <input
            value={visualKeyword}
            onChange={(e) => setVisualKeyword(e.target.value)}
            className={inputCls}
          />
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
        Save asset
      </button>
    </form>
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
