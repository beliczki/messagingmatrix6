"use client";

import { useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import ToolbarUpload from "../../_components/ToolbarUpload";

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

  return (
    <>
      <ToolbarUpload
        collapsed={collapsed}
        className="mt-auto"
        label="Upload report"
        help="Drop an AdForm Creative custom report (XLSX). Rows are aggregated to message level and matched to the matrix by audience, topic, MC number and variant."
        hint="Click or drop XLSX"
        busy={busy}
        onActivate={() => fileInputRef.current?.click()}
        onFiles={(files) => upload(files[0])}
      >
        {error ? (
          <p className="error-alert rounded-md bg-rose-50 p-2 text-[11px] text-rose-700">
            {error}
          </p>
        ) : null}
        {result ? (
          <div className="monitoring-upload__result rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800">
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
      </ToolbarUpload>
      {hiddenInput}
    </>
  );
}
