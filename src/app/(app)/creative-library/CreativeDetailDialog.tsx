"use client";

import { useEffect, useState } from "react";
import MediaEntityDialog, {
  formatBytes,
  type UploadedFile,
} from "../_components/MediaEntityDialog";
import { parseCreativeFilename } from "@/lib/parse-creative-filename";

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

type Draft = {
  brand: string;
  product: string;
  type: string;
  template: string;
  bannerVersion: string;
  visualKeyword: string;
  copyKeyword: string;
  mcNumber: string;
  mcVariant: string;
  comment: string;
};

function toDraft(c: Creative): Draft {
  return {
    brand: c.brand ?? "",
    product: c.product ?? "",
    type: c.type ?? "",
    template: c.template ?? "",
    bannerVersion: c.bannerVersion ?? "",
    visualKeyword: c.visualKeyword ?? "",
    copyKeyword: c.copyKeyword ?? "",
    mcNumber: c.mcNumber !== null ? String(c.mcNumber) : "",
    mcVariant: c.mcVariant ?? "",
    comment: c.comment ?? "",
  };
}

function diffPayload(snapshot: Creative, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ((snapshot.brand ?? "") !== draft.brand) out.brand = draft.brand || null;
  if ((snapshot.product ?? "") !== draft.product) out.product = draft.product || null;
  if ((snapshot.type ?? "") !== draft.type) out.type = draft.type || null;
  if ((snapshot.template ?? "") !== draft.template) out.template = draft.template || null;
  if ((snapshot.bannerVersion ?? "") !== draft.bannerVersion) {
    out.bannerVersion = draft.bannerVersion || null;
  }
  if ((snapshot.visualKeyword ?? "") !== draft.visualKeyword) {
    out.visualKeyword = draft.visualKeyword || null;
  }
  if ((snapshot.copyKeyword ?? "") !== draft.copyKeyword) {
    out.copyKeyword = draft.copyKeyword || null;
  }
  const snapMc = snapshot.mcNumber !== null ? String(snapshot.mcNumber) : "";
  if (snapMc !== draft.mcNumber) {
    out.mcNumber = draft.mcNumber ? Number(draft.mcNumber) : null;
  }
  if ((snapshot.mcVariant ?? "") !== draft.mcVariant) out.mcVariant = draft.mcVariant || null;
  if ((snapshot.comment ?? "") !== draft.comment) out.comment = draft.comment || null;
  return out;
}

function versionLabel(c: Creative): string {
  const banner = c.bannerVersion?.trim();
  if (banner) return banner;
  return `n${parseCreativeFilename(c.fileName ?? "").version}`;
}

export default function CreativeDetailDialog({
  creative,
  creatives,
  versions,
  filesById,
  onJump,
  onClose,
}: {
  creative: Creative;
  creatives: Creative[];
  /** Version family (oldest → newest), the representative included as last. */
  versions?: Creative[];
  filesById: Map<string, UploadedFile>;
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  // null = the representative (latest). Reset when group prev/next jumps to
  // another family — deliberately without remounting, so the autosave toggle
  // and split position survive navigation.
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  useEffect(() => {
    setSelectedVersionId(null);
  }, [creative.id]);

  const current =
    (selectedVersionId !== null
      ? versions?.find((v) => v.id === selectedVersionId)
      : undefined) ?? creative;
  const file = current.fileId ? filesById.get(current.fileId) : undefined;

  const mcLabel =
    current.mcNumber !== null
      ? `MC${current.mcNumber}${current.mcVariant ?? ""}`
      : null;
  const fileInfoRows: Array<[string, string | null]> = [
    ["File", current.fileName],
    ["Format", current.fileFormat ?? file?.mimeType ?? null],
    ["Dimensions", current.fileDimensions ?? file?.dimensions ?? null],
    ["Size", current.fileSize ? formatBytes(Number(current.fileSize)) : null],
    ["Created", new Date(current.createdAt).toLocaleString()],
  ];
  if (current.archivedAt) {
    fileInfoRows.push(["Archived", new Date(current.archivedAt).toLocaleString()]);
  }

  return (
    <MediaEntityDialog<Creative, Draft>
      entity={current}
      entities={creatives}
      navId={creative.id}
      versionNav={
        versions && versions.length > 1
          ? {
              versions: versions.map((v) => ({ id: v.id, label: versionLabel(v) })),
              currentId: current.id,
              onSelect: setSelectedVersionId,
            }
          : undefined
      }
      onJump={onJump}
      onClose={onClose}
      file={file}
      title={current.fileName ?? "(no file)"}
      subtitle={mcLabel ?? undefined}
      endpoint="/api/creatives"
      queryKey="creatives"
      toDraft={toDraft}
      diffPayload={diffPayload}
      fileInfoRows={fileInfoRows}
      renderForm={(draft, setDraft) => (
        <div className="form-grid grid grid-cols-2 gap-x-3 gap-y-2">
          <DraftField label="Brand">
            <input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Product">
            <input value={draft.product} onChange={(e) => setDraft({ ...draft, product: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Type">
            <input value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Template">
            <input value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Banner version">
            <input value={draft.bannerVersion} onChange={(e) => setDraft({ ...draft, bannerVersion: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Visual keyword">
            <input value={draft.visualKeyword} onChange={(e) => setDraft({ ...draft, visualKeyword: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="Copy keyword">
            <input value={draft.copyKeyword} onChange={(e) => setDraft({ ...draft, copyKeyword: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="MC number">
            <input value={draft.mcNumber} onChange={(e) => setDraft({ ...draft, mcNumber: e.target.value })} className={inputCls} />
          </DraftField>
          <DraftField label="MC variant">
            <input value={draft.mcVariant} onChange={(e) => setDraft({ ...draft, mcVariant: e.target.value })} className={inputCls} />
          </DraftField>
          <div className="col-span-2">
            <DraftField label="Comment">
              <textarea
                value={draft.comment}
                onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                rows={3}
                className={inputCls}
              />
            </DraftField>
          </div>
        </div>
      )}
    />
  );
}

function DraftField({
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

const inputCls =
  "input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none";
