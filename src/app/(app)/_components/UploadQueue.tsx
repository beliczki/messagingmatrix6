"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Loader2, Check, CircleAlert, X, Trash2 } from "lucide-react";
import clsx from "clsx";
import { parseFilename, type ParseRules } from "@/lib/parse-filename";

// One queued file as it moves through upload → metadata edit → save → done.
export type QueueItem = {
  localId: string; // client-side only
  file: File;
  /** Filled by parseFilename — pre-fills metadata form. */
  parsed: Record<string, string>;
  warnings: string[];
  /** Returned after /api/files/upload succeeds. */
  uploadedFileId: string | null;
  uploadedFilename: string | null;
  uploadedDimensions: string | null;
  uploadedSize: number | null;
  status: "queued" | "uploading" | "metadata" | "saving" | "done" | "error";
  error: string | null;
  /** Per-item editable metadata (overrides parsed). */
  metadata: Record<string, string>;
};

type Props = {
  category: "creative" | "asset";
  parsingRules: ParseRules;
  /**
   * Render the per-item metadata form. Caller decides which fields to expose
   * (creatives have more than assets) and how to commit the entity.
   */
  renderForm: (args: {
    item: QueueItem;
    update: (patch: Partial<QueueItem["metadata"]>) => void;
  }) => ReactNode;
  /**
   * Commit one item — typically POST /api/{creatives|assets} with the metadata
   * + uploadedFileId. Throws on failure (the queue marks it errored).
   */
  commitItem: (item: QueueItem) => Promise<void>;
  onAllDone?: () => void;
};

export function useDropTarget(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(true);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setOver(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setOver(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    },
    [onFiles],
  );
  return { over, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** The queue state machine — upload, per-item metadata, commit — with no UI of
 *  its own. `UploadQueue` below renders it as the floating panel; the assets
 *  batch dialog renders the same state as a table. */
export function useUploadQueue({
  category,
  parsingRules,
  commitItem,
  onAllDone,
}: Pick<Props, "category" | "parsingRules" | "commitItem" | "onAllDone">) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [open, setOpen] = useState(false);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const next: QueueItem[] = files.map((file) => {
        const { fields, warnings } = parseFilename(file.name, parsingRules);
        return {
          localId: cryptoRandom(),
          file,
          parsed: fields,
          warnings,
          uploadedFileId: null,
          uploadedFilename: null,
          uploadedDimensions: null,
          uploadedSize: null,
          status: "queued",
          error: null,
          metadata: { ...fields },
        };
      });
      setItems((prev) => [...prev, ...next]);
      setOpen(true);
    },
    [parsingRules],
  );

  const update = useCallback(
    (id: string, patch: Partial<QueueItem>) => {
      setItems((prev) =>
        prev.map((it) => (it.localId === id ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  // Auto-upload queued items.
  useEffect(() => {
    const next = items.find((i) => i.status === "queued");
    if (!next) return;
    update(next.localId, { status: "uploading" });
    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", next.file);
        fd.append("category", category);
        const r = await fetch("/api/files/upload", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!r.ok) throw new Error(await r.text());
        const body = (await r.json()) as {
          file: {
            id: string;
            filename: string;
            sizeBytes: number;
            dimensions: string | null;
          };
        };
        update(next.localId, {
          status: "metadata",
          uploadedFileId: body.file.id,
          uploadedFilename: body.file.filename,
          uploadedDimensions: body.file.dimensions,
          uploadedSize: body.file.sizeBytes,
        });
      } catch (e) {
        update(next.localId, {
          status: "error",
          error: (e as Error).message,
        });
      }
    })();
  }, [items, category, update]);

  async function commitAll() {
    for (const item of items) {
      if (item.status !== "metadata") continue;
      update(item.localId, { status: "saving" });
      try {
        await commitItem(item);
        update(item.localId, { status: "done" });
      } catch (e) {
        update(item.localId, {
          status: "error",
          error: (e as Error).message,
        });
      }
    }
    onAllDone?.();
  }

  function discard(id: string) {
    setItems((prev) => prev.filter((it) => it.localId !== id));
  }

  function clearDone() {
    setItems((prev) => prev.filter((it) => it.status !== "done"));
  }

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const errored = items.filter((i) => i.status === "error").length;
  const ready = items.filter((i) => i.status === "metadata").length;

  /** Patch one item's metadata (merge, not replace). */
  const updateMetadata = useCallback(
    (id: string, patch: Record<string, string>) => {
      setItems((prev) =>
        prev.map((it) =>
          it.localId === id
            ? { ...it, metadata: { ...it.metadata, ...patch } }
            : it,
        ),
      );
    },
    [],
  );

  /** Write the non-empty fields of `patch` onto every item still editable. */
  const applyToAll = useCallback((patch: Record<string, string>) => {
    const fields = Object.entries(patch).filter(([, v]) => v.trim() !== "");
    if (fields.length === 0) return;
    setItems((prev) =>
      prev.map((it) =>
        it.status === "metadata" || it.status === "error"
          ? { ...it, metadata: { ...it.metadata, ...Object.fromEntries(fields) } }
          : it,
      ),
    );
  }, []);

  function reset() {
    setItems([]);
    setOpen(false);
  }

  return {
    items,
    addFiles,
    update,
    updateMetadata,
    applyToAll,
    commitAll,
    discard,
    clearDone,
    reset,
    open,
    setOpen,
    total,
    done,
    errored,
    ready,
  };
}

export default function UploadQueue(props: Props) {
  const { renderForm } = props;
  const {
    items,
    addFiles,
    update,
    commitAll,
    discard,
    clearDone,
    reset,
    open,
    setOpen,
    total,
    done,
    errored,
    ready,
  } = useUploadQueue(props);

  return {
    addFiles,
    panel: total === 0 ? null : (
      <div
        className={clsx(
          "upload-queue fixed bottom-0 right-0 z-40 m-4 flex w-[440px] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl transition",
          open ? "upload-queue--open max-h-[70vh]" : "upload-queue--collapsed max-h-12",
        )}
      >
        <header
          onClick={() => setOpen(!open)}
          className="upload-queue__header flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm"
        >
          <span className="upload-queue__title font-semibold text-slate-900">
            Upload queue
          </span>
          <span className="upload-queue__count text-xs text-slate-500">
            {done}/{total} done
            {errored > 0 ? ` · ${errored} error` : ""}
          </span>
          {ready > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                commitAll();
              }}
              className="ml-auto rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800"
            >
              Save {ready}
            </button>
          ) : null}
          {done > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearDone();
              }}
              className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              Clear done
            </button>
          ) : null}
          <button
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            aria-label="Close queue"
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </header>
        {open ? (
          <div className="upload-queue__items flex-1 overflow-y-auto p-2">
            {items.map((item) => (
              <ItemRow
                key={item.localId}
                item={item}
                onDiscard={() => discard(item.localId)}
                onUpdate={(patch) => {
                  const merged: Record<string, string> = { ...item.metadata };
                  for (const [k, v] of Object.entries(patch)) {
                    if (typeof v === "string") merged[k] = v;
                  }
                  update(item.localId, { metadata: merged });
                }}
                renderForm={renderForm}
              />
            ))}
          </div>
        ) : null}
      </div>
    ),
  };
}

function ItemRow({
  item,
  onDiscard,
  onUpdate,
  renderForm,
}: {
  item: QueueItem;
  onDiscard: () => void;
  onUpdate: (patch: Partial<QueueItem["metadata"]>) => void;
  renderForm: Props["renderForm"];
}) {
  return (
    <div className={`upload-queue__item upload-queue__item--${item.status} mb-2 rounded-md border border-slate-200 bg-white p-2 text-xs`}>
      <div className="flex items-baseline gap-2">
        <StatusIcon status={item.status} />
        <span className="upload-queue__item-name truncate font-medium text-slate-700" title={item.file.name}>
          {item.file.name}
        </span>
        <span className="ml-auto text-[10px] text-slate-400">
          {(item.file.size / 1024).toFixed(1)} KB
        </span>
        <button
          onClick={onDiscard}
          aria-label="Discard"
          className="upload-queue__item-discard rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      {item.warnings.length > 0 && item.status === "metadata" ? (
        <div className="mt-1 rounded bg-amber-50 p-1 text-[10px] text-amber-800">
          {item.warnings.join(" · ")}
        </div>
      ) : null}
      {item.status === "error" && item.error ? (
        <div className="error-alert mt-1 rounded bg-rose-50 p-1 text-[10px] text-rose-700">
          {item.error}
        </div>
      ) : null}
      {item.status === "metadata" || item.status === "saving" ? (
        <div className="mt-2">{renderForm({ item, update: onUpdate })}</div>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: QueueItem["status"] }) {
  if (status === "uploading" || status === "saving") {
    return <Loader2 className="size-3 animate-spin text-slate-500" />;
  }
  if (status === "done") {
    return <Check className="size-3 text-emerald-600" />;
  }
  if (status === "error") {
    return <CircleAlert className="size-3 text-rose-600" />;
  }
  return <span className="size-3 rounded-full bg-slate-300" />;
}

function cryptoRandom(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
