"use client";

import { useRef, useState } from "react";
import clsx from "clsx";
import { Loader2, Upload as UploadIcon, CheckCircle2 } from "lucide-react";

type ImportResult = {
  imported: number;
  matched: number;
  unmatched: number;
  skipped: number;
  totalDataRows: number;
  periodFrom: string;
  periodTo: string;
  platforms: string[];
};

export default function MonitoringUpload({
  collapsed = false,
  onImported,
}: {
  collapsed?: boolean;
  onImported?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/monitoring/import", {
        method: "POST",
        body: form,
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.reason ?? body.error ?? "Upload failed");
        return;
      }
      setResult(body as ImportResult);
      onImported?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) upload(file);
    e.target.value = "";
  }

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      onChange={onPick}
      className="hidden"
    />
  );

  // Collapsed: just an icon button at the bottom of the rail.
  if (collapsed) {
    return (
      <>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          title="Upload AdForm report"
          aria-label="Upload AdForm report"
          className="monitoring-upload__btn mt-auto inline-flex size-9 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <UploadIcon className="size-4" />
          )}
        </button>
        {hiddenInput}
      </>
    );
  }

  // Expanded: help text + dropzone + compact status, pinned to the bottom.
  return (
    <div className="monitoring-upload mt-auto flex flex-col gap-2">
      <div className="monitoring-upload__header text-[10px] font-medium uppercase tracking-wider text-slate-500">
        Upload report
      </div>
      <p className="monitoring-upload__help text-[11px] leading-snug text-slate-500">
        Drop an AdForm Creative custom report (XLSX). Rows are aggregated to
        message level and matched to the matrix by audience, topic, MC number
        and variant.
      </p>

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        disabled={busy}
        className="monitoring-upload__dropzone flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 px-3 py-5 text-center text-xs text-slate-600 transition hover:border-slate-500 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Importing…
          </>
        ) : (
          <>
            <UploadIcon className="size-5" />
            Click or drop XLSX
          </>
        )}
      </button>
      {hiddenInput}

      {error ? (
        <p className="error-alert rounded-md bg-rose-50 p-2 text-[11px] text-rose-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          className={clsx(
            "monitoring-upload__result rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800",
          )}
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="size-3.5" />
            {result.periodFrom.slice(0, 10)} – {result.periodTo.slice(0, 10)}
          </div>
          <div className="mt-0.5 text-emerald-700">
            {result.imported.toLocaleString()} messages ·{" "}
            {result.matched.toLocaleString()} matched ·{" "}
            {result.unmatched.toLocaleString()} unmatched
          </div>
        </div>
      ) : null}
    </div>
  );
}
