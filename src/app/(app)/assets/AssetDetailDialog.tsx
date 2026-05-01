"use client";

import MediaEntityDialog, {
  formatBytes,
  type UploadedFile,
} from "../_components/MediaEntityDialog";

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

type Draft = {
  brand: string;
  product: string;
  type: string;
  visualKeyword: string;
  comment: string;
};

function toDraft(a: Asset): Draft {
  return {
    brand: a.brand ?? "",
    product: a.product ?? "",
    type: a.type ?? "",
    visualKeyword: a.visualKeyword ?? "",
    comment: a.comment ?? "",
  };
}

function diffPayload(snapshot: Asset, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ((snapshot.brand ?? "") !== draft.brand) out.brand = draft.brand || null;
  if ((snapshot.product ?? "") !== draft.product) out.product = draft.product || null;
  if ((snapshot.type ?? "") !== draft.type) out.type = draft.type || null;
  if ((snapshot.visualKeyword ?? "") !== draft.visualKeyword) {
    out.visualKeyword = draft.visualKeyword || null;
  }
  if ((snapshot.comment ?? "") !== draft.comment) out.comment = draft.comment || null;
  return out;
}

export default function AssetDetailDialog({
  asset,
  assets,
  file,
  onJump,
  onClose,
}: {
  asset: Asset;
  assets: Asset[];
  file: UploadedFile | undefined;
  onJump: (id: number) => void;
  onClose: () => void;
}) {
  const fileInfoRows: Array<[string, string | null]> = [
    ["File", asset.fileName],
    ["Format", asset.fileFormat ?? file?.mimeType ?? null],
    ["Dimensions", asset.fileDimensions ?? file?.dimensions ?? null],
    ["Size", asset.fileSize ? formatBytes(Number(asset.fileSize)) : null],
    ["Created", new Date(asset.createdAt).toLocaleString()],
  ];
  if (asset.archivedAt) {
    fileInfoRows.push(["Archived", new Date(asset.archivedAt).toLocaleString()]);
  }

  return (
    <MediaEntityDialog<Asset, Draft>
      entity={asset}
      entities={assets}
      onJump={onJump}
      onClose={onClose}
      file={file}
      title={asset.fileName ?? "(no file)"}
      subtitle={[asset.brand, asset.product].filter(Boolean).join(" · ") || undefined}
      endpoint="/api/assets"
      queryKey="assets"
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
          <DraftField label="Visual keyword">
            <input value={draft.visualKeyword} onChange={(e) => setDraft({ ...draft, visualKeyword: e.target.value })} className={inputCls} />
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
