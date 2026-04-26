"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  Search,
  X,
  Trash2,
  Image as ImageIcon,
  Loader2,
  Inbox,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import UploadDialog, { type UploadResult } from "../_components/UploadDialog";
import UploadQueue, {
  useDropTarget,
  type QueueItem,
} from "../_components/UploadQueue";
import MultiPill from "../_components/MultiPill";
import RightToolbar from "../_components/RightToolbar";
import type { ParseRules } from "@/lib/parse-filename";

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
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);

  const creativesQ = useQuery({
    queryKey: ["creatives"],
    queryFn: () => fetchJSON<{ creatives: Creative[] }>("/api/creatives"),
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return creatives.filter((c) => {
      if (products.size > 0 && (!c.product || !products.has(c.product))) {
        return false;
      }
      if (types.size > 0 && (!c.type || !types.has(c.type))) {
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
  }, [creatives, products, types, search]);

  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (c: Creative) => {
      const r = await fetch(`/api/creatives/${c.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "If-Match": String(c.version) },
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["creatives"] }),
  });

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar
          search={search}
          setSearch={setSearch}
          productOptions={productOptions}
          products={products}
          setProducts={setProducts}
          typeOptions={typeOptions}
          types={types}
          setTypes={setTypes}
          total={creatives.length}
          visible={filtered.length}
          onUpload={() => setUploadOpen(true)}
        />

        <div
          className={clsx(
            "relative flex-1 overflow-auto p-4 transition",
            drop.over && "bg-slate-100 ring-2 ring-inset ring-slate-900",
          )}
          {...drop.handlers}
        >
          {drop.over ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="rounded-xl bg-slate-900/90 px-5 py-3 text-sm font-medium text-white">
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
            <Masonry
              items={filtered}
              render={(c) => (
                <Card
                  creative={c}
                  file={c.fileId ? filesById.get(c.fileId) : undefined}
                  onDelete={() => del.mutate(c)}
                />
              )}
            />
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
      </div>

      <RightToolbar storageKey="mm6_creative_library_right_toolbar_open" />
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
  total,
  visible,
  onUpload,
}: {
  search: string;
  setSearch: (s: string) => void;
  productOptions: string[];
  products: Set<string>;
  setProducts: (s: Set<string>) => void;
  typeOptions: string[];
  types: Set<string>;
  setTypes: (s: Set<string>) => void;
  total: number;
  visible: number;
  onUpload: () => void;
}) {
  const activeFilters = products.size + types.size + (search ? 1 : 0);
  return (
    <div className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex items-baseline gap-2">
        <div className="text-sm font-semibold text-slate-900">Creative Library</div>
        <div className="text-xs text-slate-500">
          {visible}/{total} creatives
        </div>
      </div>

      <div className="relative ml-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filename, brand, MC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

      <MultiPill label="Product" values={products} options={productOptions} onChange={setProducts} />
      <MultiPill label="Type" values={types} options={typeOptions} onChange={setTypes} />

      {activeFilters > 0 ? (
        <button
          onClick={() => {
            setProducts(new Set());
            setTypes(new Set());
            setSearch("");
          }}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      <button
        onClick={onUpload}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        <UploadIcon className="size-3.5" />
        Upload
      </button>
    </div>
  );
}

function Card({
  creative,
  file,
  onDelete,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onDelete: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const mcLabel =
    creative.mcNumber !== null
      ? `MC${creative.mcNumber}${creative.mcVariant ?? ""}`
      : null;
  return (
    <div className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-slate-400 hover:shadow-md">
      <div className="relative aspect-[4/3] bg-slate-50">
        {isImage && creative.fileId ? (
          <img
            src={`/api/files/${creative.fileId}/thumbnail?w=400`}
            alt={creative.fileName ?? "creative"}
            className="size-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-slate-300">
            <ImageIcon className="size-8" />
          </div>
        )}
        <button
          onClick={onDelete}
          aria-label="Delete"
          className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-rose-600 opacity-0 shadow transition group-hover:opacity-100 hover:bg-rose-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="p-2 text-xs">
        <div className="flex items-baseline gap-2">
          {mcLabel ? (
            <span className="font-mono font-semibold text-slate-900">{mcLabel}</span>
          ) : null}
          <span className="truncate text-slate-700" title={creative.fileName ?? ""}>
            {creative.fileName ?? "(no file)"}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {creative.brand ? <span>{creative.brand}</span> : null}
          {creative.product ? <span>· {creative.product}</span> : null}
          {creative.template ? <span>· {creative.template}</span> : null}
          {creative.fileDimensions ? <span>· {creative.fileDimensions}</span> : null}
        </div>
      </div>
    </div>
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
    <form onSubmit={onSubmit} className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
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
          "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white",
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
  "w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none";

function QueueItemForm({
  item,
  update,
}: {
  item: QueueItem;
  update: (patch: Partial<QueueItem["metadata"]>) => void;
}) {
  const cellCls =
    "rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs focus:border-slate-500 focus:outline-none";
  const fields: Array<{ k: string; label: string }> = [
    { k: "brand", label: "Brand" },
    { k: "product", label: "Product" },
    { k: "type", label: "Type" },
    { k: "mcNumber", label: "MC#" },
    { k: "mcVariant", label: "Variant" },
  ];
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {fields.map((f) => (
        <label key={f.k} className="block">
          <div className="mb-0.5 text-[9px] uppercase tracking-wide text-slate-500">
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
    <label className="block">
      <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
      <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <ImageIcon className="mx-auto mb-2 size-8 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">
          {empty ? "No creatives yet" : "No creatives match the filters"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {empty
            ? "Upload an HTML banner, a static image, or a video clip."
            : "Clear filters or adjust the search to see all creatives."}
        </p>
        {empty ? (
          <button
            onClick={onUpload}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <UploadIcon className="size-3.5" />
            Upload first creative
          </button>
        ) : null}
      </div>
    </div>
  );
}

