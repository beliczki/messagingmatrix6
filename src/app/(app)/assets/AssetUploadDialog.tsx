"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Check, CircleAlert, Trash2, Upload, X } from "lucide-react";
import clsx from "clsx";
import ModalBackdrop from "../_components/ModalBackdrop";
import {
  useDropTarget,
  useUploadQueue,
  type QueueItem,
} from "../_components/UploadQueue";
import { type ParseRules } from "@/lib/parse-filename";

// The metadata columns an asset row exposes. Order = column order in the table
// and in the batch row above it.
const COLUMNS: Array<{ key: string; label: string }> = [
  { key: "brand", label: "Brand" },
  { key: "product", label: "Product" },
  { key: "type", label: "Type" },
  { key: "visualKeyword", label: "Keywords" },
];

const inputCls =
  "input-box w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:border-slate-500 focus:outline-none";

type Props = {
  open: boolean;
  /** Files handed over by the page's drop target; [] when opened by the button. */
  initialFiles: File[];
  parsingRules: ParseRules;
  productOptions: string[];
  typeOptions: string[];
  commitItem: (item: QueueItem) => Promise<void>;
  onAllDone: () => void;
  onClose: () => void;
};

export default function AssetUploadDialog({
  open,
  initialFiles,
  parsingRules,
  productOptions,
  typeOptions,
  commitItem,
  onAllDone,
  onClose,
}: Props) {
  const queue = useUploadQueue({
    category: "asset",
    parsingRules,
    commitItem,
    onAllDone,
  });
  const { addFiles, items } = queue;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batch, setBatch] = useState<Record<string, string>>({});

  // The page hands the dropped files over once, on open.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    if (initialFiles.length > 0) addFiles(initialFiles);
  }, [open, initialFiles, addFiles]);

  const drop = useDropTarget(addFiles);

  const saving = items.some((i) => i.status === "saving");
  const ready = items.filter((i) => i.status === "metadata").length;
  const done = items.filter((i) => i.status === "done").length;
  const errored = items.filter((i) => i.status === "error").length;
  const busy = items.some(
    (i) => i.status === "queued" || i.status === "uploading",
  );

  // Datalists keep the existing values discoverable without locking the field
  // to them — the filename parser can produce values nobody has used yet.
  const optionsFor = useMemo(
    () => ({ product: productOptions, type: typeOptions }) as Record<string, string[]>,
    [productOptions, typeOptions],
  );

  if (!open) return null;

  function close() {
    queue.reset();
    setBatch({});
    onClose();
  }

  return (
    <ModalBackdrop onClose={close} className="z-50 items-stretch">
      <div
        className="asset-upload-dialog modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        {...drop.handlers}
      >
        <header className="asset-upload-dialog__header modal__header flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
          <Upload className="size-4 text-slate-500" />
          <span className="asset-upload-dialog__title text-sm font-semibold text-slate-900">
            Upload assets
          </span>
          <span className="asset-upload-dialog__count text-xs text-slate-500">
            {items.length === 0
              ? "no files yet"
              : `${items.length} file${items.length === 1 ? "" : "s"} · ${done} saved${
                  errored > 0 ? ` · ${errored} error` : ""
                }`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="toolbar-btn rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Add files
            </button>
            <button
              onClick={() => queue.commitAll()}
              disabled={ready === 0 || saving || busy}
              className="toolbar-btn--primary rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="mr-1 inline size-3 animate-spin" />
              ) : null}
              Save {ready > 0 ? ready : ""}
            </button>
            <button
              onClick={close}
              aria-label="Close"
              className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            if (picked.length > 0) addFiles(picked);
            e.target.value = "";
          }}
        />

        {items.length === 0 ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className={clsx(
              "asset-upload-dialog__dropzone m-6 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm transition",
              drop.over
                ? "border-slate-900 bg-slate-100 text-slate-900"
                : "border-slate-300 text-slate-500 hover:bg-slate-50",
            )}
          >
            <Upload className="size-6" />
            Drop files here, or click to choose — as many as you like
          </button>
        ) : (
          <div className="asset-upload-dialog__body relative flex-1 overflow-auto">
            {drop.over ? (
              <div className="drop-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-900/10">
                <div className="drop-overlay__message rounded-xl bg-slate-900/90 px-5 py-3 text-sm font-medium text-white">
                  Drop to add more files
                </div>
              </div>
            ) : null}
            <table className="asset-upload-table w-full border-collapse text-xs">
              <thead className="asset-upload-table__head sticky top-0 z-10 bg-white">
                <tr>
                  <th className="w-[300px] border-b border-slate-200 px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    File
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="border-b border-slate-200 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="w-10 border-b border-slate-200" />
                </tr>
                <tr className="asset-upload-table__batch bg-slate-50">
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Set for all
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="border-b border-slate-200 px-2 py-2">
                      <input
                        value={batch[c.key] ?? ""}
                        onChange={(e) =>
                          setBatch((b) => ({ ...b, [c.key]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") queue.applyToAll(batch);
                        }}
                        list={optionsFor[c.key] ? `asset-upload-${c.key}` : undefined}
                        placeholder={c.label}
                        className={inputCls}
                      />
                      {optionsFor[c.key] ? (
                        <datalist id={`asset-upload-${c.key}`}>
                          {optionsFor[c.key].map((o) => (
                            <option key={o} value={o} />
                          ))}
                        </datalist>
                      ) : null}
                    </th>
                  ))}
                  <th className="border-b border-slate-200 px-2 py-2">
                    <button
                      onClick={() => queue.applyToAll(batch)}
                      title="Write these values onto every row"
                      className="asset-upload-table__apply toolbar-btn whitespace-nowrap rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                    >
                      Apply
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Row
                    key={item.localId}
                    item={item}
                    optionsFor={optionsFor}
                    onChange={(patch) => queue.updateMetadata(item.localId, patch)}
                    onDiscard={() => queue.discard(item.localId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

function Row({
  item,
  optionsFor,
  onChange,
  onDiscard,
}: {
  item: QueueItem;
  optionsFor: Record<string, string[]>;
  onChange: (patch: Record<string, string>) => void;
  onDiscard: () => void;
}) {
  // Local object URL so the row shows what the file actually is, not just a
  // filename — revoked when the row goes away.
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!item.file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(item.file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);

  const editable = item.status === "metadata" || item.status === "error";

  return (
    <tr
      className={clsx(
        "asset-upload-table__row border-b border-slate-100",
        item.status === "done" && "asset-upload-table__row--done opacity-50",
      )}
    >
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2">
          <StatusIcon status={item.status} />
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              className="asset-upload-table__thumb size-9 shrink-0 rounded border border-slate-200 object-cover"
            />
          ) : (
            <span className="asset-upload-table__thumb size-9 shrink-0 rounded border border-slate-200 bg-slate-100" />
          )}
          <div className="min-w-0">
            <div
              className="asset-upload-table__filename truncate font-medium text-slate-700"
              title={item.file.name}
            >
              {item.file.name}
            </div>
            <div className="text-[10px] text-slate-400">
              {(item.file.size / 1024).toFixed(1)} KB
              {item.uploadedDimensions ? ` · ${item.uploadedDimensions}` : ""}
            </div>
            {item.status === "error" && item.error ? (
              <div className="error-alert mt-0.5 truncate text-[10px] text-rose-600" title={item.error}>
                {item.error}
              </div>
            ) : null}
            {item.warnings.length > 0 && editable ? (
              <div className="mt-0.5 truncate text-[10px] text-amber-700" title={item.warnings.join(" · ")}>
                {item.warnings.join(" · ")}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      {COLUMNS.map((c) => (
        <td key={c.key} className="px-2 py-1.5">
          <input
            value={item.metadata[c.key] ?? ""}
            onChange={(e) => onChange({ [c.key]: e.target.value })}
            disabled={!editable}
            list={optionsFor[c.key] ? `asset-upload-${c.key}` : undefined}
            className={clsx(inputCls, !editable && "opacity-50")}
          />
        </td>
      ))}
      <td className="px-2 py-1.5">
        <button
          onClick={onDiscard}
          aria-label={`Discard ${item.file.name}`}
          className="asset-upload-table__discard rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="size-3.5" />
        </button>
      </td>
    </tr>
  );
}

function StatusIcon({ status }: { status: QueueItem["status"] }) {
  if (status === "uploading" || status === "saving") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-slate-500" />;
  }
  if (status === "done") return <Check className="size-3.5 shrink-0 text-emerald-600" />;
  if (status === "error") return <CircleAlert className="size-3.5 shrink-0 text-rose-600" />;
  return <span className="size-3.5 shrink-0 rounded-full bg-slate-300" />;
}
