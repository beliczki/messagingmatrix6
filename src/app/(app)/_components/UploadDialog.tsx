"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { X, Upload as UploadIcon, Loader2 } from "lucide-react";
import ModalBackdrop from "./ModalBackdrop";

export type UploadResult = {
  fileId: string;
  filename: string;
  sizeBytes: number;
  mimeType: string | null;
  dimensions: string | null;
};

type Props = {
  open: boolean;
  category: "creative" | "asset";
  onClose: () => void;
  onUploaded: (file: UploadResult) => void;
  /** Called after the file uploads successfully but before the dialog closes,
   *  so the caller can attach metadata (e.g. POST /api/creatives). */
  metadataForm?: (state: {
    file: UploadResult | null;
    submit: (extra: Record<string, unknown>) => Promise<void>;
    submitting: boolean;
  }) => ReactNode;
};

export default function UploadDialog({
  open,
  category,
  onClose,
  onUploaded,
  metadataForm,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"pick" | "uploading" | "metadata" | "saving" | "done">(
    "pick",
  );

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setUploaded(null);
      setError(null);
      setPhase("pick");
    }
  }, [open]);

  if (!open) return null;

  async function uploadFile(f: File) {
    setError(null);
    setPhase("uploading");
    const fd = new FormData();
    fd.append("file", f);
    fd.append("category", category);
    const r = await fetch("/api/files/upload", {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    if (!r.ok) {
      setError(await r.text());
      setPhase("pick");
      return;
    }
    const body = (await r.json()) as {
      file: {
        id: string;
        filename: string;
        sizeBytes: number;
        mimeType: string | null;
        dimensions: string | null;
      };
    };
    const result: UploadResult = {
      fileId: body.file.id,
      filename: body.file.filename,
      sizeBytes: body.file.sizeBytes,
      mimeType: body.file.mimeType,
      dimensions: body.file.dimensions,
    };
    setUploaded(result);
    onUploaded(result);
    if (metadataForm) {
      setPhase("metadata");
    } else {
      setPhase("done");
      onClose();
    }
  }

  async function submitMetadata(extra: Record<string, unknown>) {
    void extra;
    setPhase("saving");
    setPhase("done");
    onClose();
  }

  function onPick(e: FormEvent<HTMLInputElement>) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
      setPicked(f);
      uploadFile(f);
    }
  }

  return (
    <ModalBackdrop
      onClose={onClose}
      className="z-50 items-center justify-center p-6"
    >
      <div
        className={`upload-dialog modal upload-dialog--${phase} w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl`}
      >
        <header className="modal__header flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="upload-dialog__title text-base font-semibold text-slate-900">
            Upload {category}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="modal__body px-4 py-4">
          {phase === "pick" || phase === "uploading" ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={phase === "uploading"}
                className="upload-dialog__dropzone flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-sm text-slate-600 transition hover:border-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                {phase === "uploading" ? (
                  <>
                    <Loader2 className="size-6 animate-spin" />
                    Uploading {picked?.name ?? ""}…
                  </>
                ) : (
                  <>
                    <UploadIcon className="size-6" />
                    Click to choose a file
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={onPick}
                className="hidden"
              />
              {picked ? (
                <p className="mt-3 text-xs text-slate-500">
                  {picked.name} — {(picked.size / 1024).toFixed(1)} KB
                </p>
              ) : null}
              {error ? (
                <p className="error-alert mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}

          {phase === "metadata" || phase === "saving" ? (
            <>
              <div className="mb-3 rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">
                Uploaded {uploaded?.filename}
                {uploaded?.dimensions ? ` (${uploaded.dimensions})` : null}.
                Add details below.
              </div>
              {metadataForm
                ? metadataForm({
                    file: uploaded,
                    submit: submitMetadata,
                    submitting: phase === "saving",
                  })
                : null}
            </>
          ) : null}
        </div>
      </div>
    </ModalBackdrop>
  );
}
